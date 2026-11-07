// @ts-nocheck

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export default function (pi) {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) return;

  const dir = path.join(homedir(), ".cache/over9k/pi");
  const file = path.join(dir, `${terminal}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  const rows = new Map();
  let root = false;
  let last = null;
  let timer;
  let expiry;

  function write() {
    if (!root) return;
    const manager = globalThis[Symbol.for("pi-subagents:manager")];
    const now = Date.now();
    for (const [id, entry] of rows) {
      const record = manager?.getRecord(id);
      if (record) {
        const done = record.status !== "queued" && record.status !== "running";
        entry.doneAt = done ? (record.completedAt ?? entry.doneAt ?? now) : null;
        entry.row = {
          id,
          at: (record.completedAt ?? entry.activity ?? record.startedAt) / 1000,
          desc: record.description,
          type: record.type,
          model: record.invocation?.modelId?.replace(/^[^/]+\//, "") ?? null,
          start: record.startedAt / 1000,
          tokens: entry.tokens,
          effort: record.invocation?.thinking ?? null,
          window: record.session?.model?.contextWindow ?? 200000,
          done,
          file: record.outputFile ?? null,
        };
      } else if (entry.row) {
        entry.doneAt ??= now;
        entry.row.done = true;
      }
      if (entry.doneAt && now - entry.doneAt >= 600000) rows.delete(id);
    }
    const json = JSON.stringify([...rows.values()].map((entry) => entry.row).filter(Boolean));
    if (json !== last) {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(temp, json);
        renameSync(temp, file);
        last = json;
      } catch {}
    }
    clearTimeout(expiry);
    const next = Math.min(...[...rows.values()].map((entry) => entry.doneAt ? entry.doneAt + 600000 : Infinity));
    if (Number.isFinite(next)) {
      expiry = setTimeout(write, Math.max(1, next - now));
      expiry.unref?.();
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(write, 250);
    timer.unref?.();
  }

  for (const name of ["created", "started", "completed", "failed", "usage"]) {
    pi.events.on(`subagents:${name}`, (event) => {
      if (!root || !event?.id || event.parentAgentId || event.workflowId) return;
      const entry = rows.get(event.id) ?? { tokens: 0 };
      if (name === "usage") {
        entry.activity = Date.now();
        entry.tokens = (event.usage?.input ?? 0) + (event.usage?.cacheRead ?? 0) + (event.usage?.cacheWrite ?? 0);
      }
      rows.set(event.id, entry);
      schedule();
    });
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx?.mode !== "tui") return;
    root = true;
    clearTimeout(timer);
    clearTimeout(expiry);
    rows.clear();
    last = null;
    write();
  });

  pi.on("session_shutdown", () => {
    if (!root) return;
    root = false;
    clearTimeout(timer);
    clearTimeout(expiry);
    try { unlinkSync(file); } catch {}
  });
}
