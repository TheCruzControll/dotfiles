import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeConversation,
  countMessagesSinceCursor,
  decideCheckpoint,
  entriesToMessages,
} from "../extension/workflow-observer/lib/analyzer.js";
import { reconstructObserverState } from "../extension/workflow-observer/lib/session-state.js";
import { openObserverStore } from "../extension/workflow-observer/lib/global-store.js";
import { findDedicatedBuildWorkspace, OBSERVER_BUILD_WORKSPACE_LABEL } from "../extension/workflow-observer/lib/herdr.js";

const config = {
  enabled: true,
  minNewMessages: 4,
  cooldownMs: 60_000,
  maxMessages: 24,
  maxSuggestionsPerRun: 3,
};

test("entriesToMessages keeps only user and assistant text", () => {
  const messages = entriesToMessages([
    {
      id: "u1",
      type: "message",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    },
    {
      id: "t1",
      type: "message",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "toolResult", content: [{ type: "text", text: "ignore" }] },
    },
    {
      id: "a1",
      type: "message",
      timestamp: "2026-01-01T00:00:02.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
    },
  ]);

  assert.deepEqual(messages.map((message) => [message.id, message.role, message.text]), [
    ["u1", "user", "hello"],
    ["a1", "assistant", "done"],
  ]);
});

test("countMessagesSinceCursor uses the active cursor when present", () => {
  const messages = [
    { id: "m1", role: "user", text: "a" },
    { id: "m2", role: "assistant", text: "b" },
    { id: "m3", role: "user", text: "c" },
  ];

  assert.equal(countMessagesSinceCursor(messages, "m2"), 1);
  assert.equal(countMessagesSinceCursor(messages, "missing"), 3);
});

test("decideCheckpoint respects activity and cooldown", () => {
  const messages = [
    { id: "m1", role: "user", text: "one" },
    { id: "m2", role: "assistant", text: "two" },
    { id: "m3", role: "user", text: "three" },
    { id: "m4", role: "assistant", text: "four" },
    { id: "m5", role: "user", text: "five" },
  ];

  const ready = decideCheckpoint({
    messages,
    state: { enabled: true, lastCheckpoint: { cursorMessageId: "m1", reviewedAt: "2026-01-01T00:00:00.000Z" } },
    config,
    now: Date.parse("2026-01-01T00:02:00.000Z"),
  });
  assert.equal(ready.shouldRun, true);

  const cooling = decideCheckpoint({
    messages,
    state: { enabled: true, lastCheckpoint: { cursorMessageId: "m1", reviewedAt: "2026-01-01T00:01:30.000Z" } },
    config,
    now: Date.parse("2026-01-01T00:02:00.000Z"),
  });
  assert.equal(cooling.shouldRun, false);
  assert.match(cooling.reason, /cooldown/);
});

test("analyzeConversation surfaces bounded workflow suggestions", () => {
  const messages = [
    { id: "1", role: "user", text: "This project is separate. Do not change the other repo." },
    { id: "2", role: "assistant", text: "Running the full test suite again: 400 passed." },
    { id: "3", role: "user", text: "continue" },
    { id: "4", role: "assistant", text: "Integration tests passed too." },
    { id: "5", role: "user", text: "continue" },
    { id: "6", role: "assistant", text: "Typecheck passed and more tests are green." },
    { id: "7", role: "user", text: "continue" },
    { id: "8", role: "user", text: "Keep everything in Pi only and leave the other runtime unchanged." },
    { id: "9", role: "user", text: "why are there so many tests?" },
    { id: "10", role: "user", text: "create a handoff doc for the next session" },
    { id: "11", role: "assistant", text: "I created a restart prompt for the new session." },
  ];

  const suggestions = analyzeConversation(messages, { seenFingerprints: new Set(), dismissedFingerprints: new Set() }, config);
  const ruleIds = suggestions.map((suggestion) => suggestion.ruleId);

  assert.ok(ruleIds.includes("scope-boundary"));
  assert.ok(ruleIds.includes("continuation-loop"));
  assert.ok(ruleIds.includes("validation-focus"));
  assert.ok(ruleIds.includes("handoff-timing"));
});

test("reconstructObserverState keeps dismissals out of the visible list", () => {
  const branch = [
    {
      type: "custom",
      customType: "workflow-observer",
      data: { action: "suggestion", suggestion: { fingerprint: "abc12345", title: "Keep it local", createdAt: "2026-01-01T00:00:00.000Z" } },
    },
    {
      type: "custom",
      customType: "workflow-observer",
      data: { action: "dismiss", fingerprint: "abc12345" },
    },
  ];

  const state = reconstructObserverState(branch, config);
  assert.equal(state.suggestions.length, 0);
  assert.equal(state.dismissedFingerprints.has("abc12345"), true);
});

test("analyzeConversation fingerprints suggestions per project path", () => {
  const messages = [
    { id: "1", role: "user", text: "This project is separate. Do not change the other repo." },
    { id: "2", role: "assistant", text: "okay" },
    { id: "3", role: "user", text: "Keep everything in Pi only and leave the other runtime unchanged." },
  ];

  const first = analyzeConversation(messages, { seenFingerprints: new Set(), suppressedFingerprints: new Set() }, config, {
    projectPath: "/tmp/project-a",
  });
  const second = analyzeConversation(messages, { seenFingerprints: new Set(), suppressedFingerprints: new Set() }, config, {
    projectPath: "/tmp/project-b",
  });

  const firstScope = first.find((suggestion) => suggestion.ruleId === "scope-boundary");
  const secondScope = second.find((suggestion) => suggestion.ruleId === "scope-boundary");

  assert.ok(firstScope);
  assert.ok(secondScope);
  assert.notEqual(firstScope?.fingerprint, secondScope?.fingerprint);
});

test("global store hides dismissed and worked suggestions but remembers suppression", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-store-"));
  const storePath = path.join(tempDir, "observer.sqlite");
  const store = openObserverStore({ storePath, enabled: true, resolvedRetentionDays: 30 });

  try {
    const suggestion = {
      fingerprint: "fingerprint-a",
      ruleId: "scope-boundary",
      title: "Pin the project boundary",
      summary: "Recent messages include repeated scope corrections.",
      recommendation: "Write a local boundary note.",
      featureRefs: ["handoff"],
      evidence: [{ id: "m1", role: "user", quote: "Do not change the other repo." }],
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    store.upsertSuggestions({
      suggestions: [suggestion],
      projectPath: "/tmp/project-a",
      sourceSessionPath: "/tmp/session-a.jsonl",
    });
    store.markDismissed(suggestion.fingerprint);

    let state = store.loadState({ sessionKey: "/tmp/session-a.jsonl" });
    assert.equal(state.suggestions.length, 0);
    assert.equal(state.suppressedFingerprints.has(suggestion.fingerprint), true);

    store.upsertSuggestions({
      suggestions: [suggestion],
      projectPath: "/tmp/project-a",
      sourceSessionPath: "/tmp/session-a.jsonl",
    });
    state = store.loadState({ sessionKey: "/tmp/session-a.jsonl" });
    assert.equal(state.suggestions.length, 0);

    store.markWorked(suggestion.fingerprint);
    state = store.loadState({ sessionKey: "/tmp/session-a.jsonl" });
    assert.equal(state.suggestions.length, 0);
    assert.equal(state.suppressedFingerprints.has(suggestion.fingerprint), true);
  } finally {
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("reconstructObserverState restores tracked build metadata", () => {
  const branch = [
    {
      type: "custom",
      customType: "workflow-observer",
      data: {
        action: "build",
        build: {
          fingerprint: "build123",
          workspacePath: "/tmp/observer",
          promptPath: "/tmp/observer/requests/build123.md",
          tabId: "w1:t9",
          paneId: "w1:p9",
          status: "launched",
        },
      },
    },
  ];

  const state = reconstructObserverState(branch, config);
  assert.equal(state.buildsByFingerprint.get("build123")?.paneId, "w1:p9");
});

test("findDedicatedBuildWorkspace prefers the focused matching workspace", () => {
  const workspace = findDedicatedBuildWorkspace([
    { workspace_id: "w1", label: OBSERVER_BUILD_WORKSPACE_LABEL, number: 2, focused: false },
    { workspace_id: "w2", label: "Other", number: 8, focused: true },
    { workspace_id: "w3", label: OBSERVER_BUILD_WORKSPACE_LABEL, number: 1, focused: true },
  ]);

  assert.equal(workspace?.workspace_id, "w3");
});

test("findDedicatedBuildWorkspace falls back to the newest matching workspace", () => {
  const workspace = findDedicatedBuildWorkspace([
    { workspace_id: "w1", label: OBSERVER_BUILD_WORKSPACE_LABEL, number: 1, focused: false },
    { workspace_id: "w2", label: OBSERVER_BUILD_WORKSPACE_LABEL, number: 4, focused: false },
  ]);

  assert.equal(workspace?.workspace_id, "w2");
});
