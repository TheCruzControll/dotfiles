import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import {
  analyzeConversation,
  decideCheckpoint,
  entriesToMessages,
  formatSuggestionLines,
} from "./lib/analyzer.ts";
import { defaultObserverState, resolveSuggestionFingerprint } from "./lib/session-state.ts";
import { openObserverStore } from "./lib/global-store.ts";
import { findDedicatedBuildWorkspace, OBSERVER_BUILD_WORKSPACE_LABEL } from "./lib/herdr.ts";
import { registerWorkflowEvidenceListener } from "./lib/workflow-evidence.ts";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(extensionDir, "config.json");
const OBSERVER_WORKSPACE_DIRNAME = ".observer-workspace";
const HERDR_BIN = process.env.HERDR_BIN_PATH || "herdr";

// Keep this boundary in the entrypoint: a warm host may retain older helper exports.
export function resolveObserverProjectPath(projectPath) {
  if (typeof projectPath !== "string" || !path.isAbsolute(projectPath)) throw new TypeError("Observer requires an absolute project path");
  const canonical = fs.realpathSync(projectPath);
  if (!fs.statSync(canonical).isDirectory()) throw new TypeError("Observer project path is not a directory");
  return canonical;
}

function loadConfig() {
  const defaults = {
    enabled: true,
    minNewMessages: 6,
    cooldownMs: 15 * 60 * 1000,
    maxMessages: 24,
    maxSuggestionsPerRun: 3,
    showWidget: true,
    statusKey: "workflow-observer",
  };

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function renderStatus(theme, state, phase) {
  if (!state.enabled) {
    return theme.fg("dim", "obs:off");
  }

  if (phase === "reviewing") {
    return theme.fg("accent", "obs…");
  }

  if (state.suggestions.length > 0) {
    return theme.fg("success", `obs:${state.suggestions.length}`);
  }

  return theme.fg("dim", "obs");
}

function buildWidgetLines(theme, state, phase) {
  if (!state.enabled) {
    return [theme.fg("dim", "Observer off · /observer on")];
  }

  if (phase !== "reviewing" && state.suggestions.length === 0) {
    return undefined;
  }

  const lines = [];
  if (phase === "reviewing") {
    lines.push(theme.fg("accent", "Observer reviewing checkpoints…"));
    lines.push(theme.fg("dim", "Commands: /observer open · /observer off"));
    return lines;
  }

  lines.push(theme.fg("accent", `Observer: ${state.suggestions.length} pending`));
  for (const suggestion of state.suggestions.slice(0, 3)) {
    const build = state.buildsByFingerprint.get(suggestion.fingerprint);
    const marker = build?.liveStatus === "working" ? "●" : build ? "◌" : "•";
    lines.push(theme.fg("dim", `${marker} ${suggestion.title} [${suggestion.fingerprint.slice(0, 8)}]`));
  }
  lines.push(theme.fg("dim", "Commands: /observer open · /observer run · /observer off"));
  return lines;
}

function notify(ctx, message, level = "info") {
  if (ctx?.hasUI) {
    ctx.ui.notify(message, level);
  }
}

function formatStatusText(state, phase) {
  const lastReview = state.lastCheckpoint?.reviewedAt ?? "never";
  const activeBuilds = [...state.buildsByFingerprint.values()].filter((build) => build).length;
  return [
    `enabled: ${state.enabled}`,
    `phase: ${phase}`,
    `pending suggestions: ${state.suggestions.length}`,
    `tracked builds: ${activeBuilds}`,
    `last review: ${lastReview}`,
  ].join("\n");
}

function wrapBlock(text, width, indent = "") {
  return wrapTextWithAnsi(`${indent}${text}`, width).map((line) => truncateToWidth(line, width));
}

function loadExplicitSession(sessionPath) {
  return SessionManager.open(sessionPath);
}

function getSessionPath(sessionManager) {
  return sessionManager?.getSessionFile?.() ?? undefined;
}

function getSessionKey(sessionManager) {
  return getSessionPath(sessionManager) ?? sessionManager?.getSessionId?.() ?? "ephemeral";
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildStatusLabel(build) {
  if (!build) {
    return "not built yet";
  }
  if (build.liveStatus === "working") {
    return "working in observer tab";
  }
  if (build.liveStatus === "idle" || build.liveStatus === "done") {
    return "session launched and idle";
  }
  if (build.liveStatus === "blocked") {
    return "waiting on input or approval";
  }
  if (build.liveStatus === "missing") {
    return "previous build tab missing";
  }
  if (build.liveStatus === "starting") {
    return "tab created, waiting for Pi detection";
  }
  return build.status ?? "build launched";
}

function buildPromptText(suggestion, build, sourceProjectPath) {
  return [
    `# Observer build request`,
    ``,
    `You are the observer build session for this project. Complete the approved workflow suggestion below.`,
    ``,
    `## Suggestion`,
    `- Title: ${suggestion.title}`,
    `- ID: ${suggestion.fingerprint}`,
    `- Summary: ${suggestion.summary}`,
    `- Recommendation: ${suggestion.recommendation}`,
    suggestion.payoff ? `- Payoff: ${suggestion.payoff}` : undefined,
    suggestion.tradeoff ? `- Tradeoff: ${suggestion.tradeoff}` : undefined,
    suggestion.featureRefs?.length ? `- Feature refs: ${suggestion.featureRefs.join(", ")}` : undefined,
    ``,
    `## Evidence`,
    ...(suggestion.evidence?.length
      ? suggestion.evidence.map((item) => `- ${item.role} ${item.id}: ${item.quote}`)
      : ["- No evidence excerpt stored."]),
    ``,
    `## Project constraints`,
    build.candidateId ? `- Source evidence came from ${sourceProjectPath}; implement only in the approved workflow candidate at ${build.workspacePath}.` : `- Work inside ${sourceProjectPath}`,
    build.candidateId ? `- Passing candidates affect new workflow tasks across coding projects; active tasks stay pinned. Rollback is available with /workflow rollback.` : undefined,
    build.candidateId ? `- Edit candidate contents only in the existing Markdown files under workflows/ and principles/. Do not modify candidate code, metadata, tests or receipts. Behavioral fixtures may be created only in controller-prepared isolated test workspaces, never in the source project or unrelated projects.` : `- Use ${build.workspacePath} for observer-only notes and artifacts if needed.`,
    `- Do not modify global Pi settings or unrelated projects unless the prompt explicitly requires it.`,
    build.candidateId ? `- As the top-level coordinator, call workflow_candidate_context for the exact candidate digest and required scenario checklist. Use the Eval workflow and existing agent limits to collect actual boundary scenarios, independent review and paired off/on pilot evidence on different projects. Report unavailable checks instead of fabricating evidence. Submit the complete report with workflow_candidate_acceptance; a child cannot attest its own acceptance. Candidate wording alone is not a passing check. Activation requires this evidence plus structural checks and the release gate; do not claim activation.` : `- Update the local observer implementation only as needed to complete this suggestion.`,
    `- Validate the change before declaring it done.`,
    build.candidateId ? `- After all edits and owned child work finish, call workflow_candidate_complete. Evaluation waits for final settlement; promotion may remain disabled by release gates.` : undefined,
    ``,
    `## Deliverable`,
    `Implement the suggestion and leave a concise summary of what changed, what was checked, and any remaining tradeoffs.`,
  ].filter(Boolean).join("\n");
}

function ensureObserverWorkspace(sourceProjectPath) {
  const workspacePath = path.join(sourceProjectPath, OBSERVER_WORKSPACE_DIRNAME);
  const requestsPath = path.join(workspacePath, "requests");
  fs.mkdirSync(requestsPath, { recursive: true });

  const readmePath = path.join(workspacePath, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      [
        `# Observer workspace`,
        ``,
        `This directory stores workflow-observer build prompts and related local artifacts.`,
        `It is created by the workflow observer extension when a suggestion is sent to a dedicated build session.`,
      ].join("\n"),
      "utf8",
    );
  }

  return { workspacePath, requestsPath };
}

async function runJsonCommand(pi, command, args) {
  const result = await pi.exec(command, args, { timeout: 30_000 });
  const stdout = result.stdout?.trim() ?? "";
  if (!stdout) {
    throw new Error(result.stderr?.trim() || `No JSON output from ${command}`);
  }
  return JSON.parse(stdout);
}

async function refreshBuildStatuses(pi, state, store) {
  if (process.env.HERDR_ENV !== "1" || state.buildsByFingerprint.size === 0) {
    return;
  }

  const workspacePayload = await runJsonCommand(pi, HERDR_BIN, ["workspace", "list"]).catch(() => undefined);
  const workspacesById = new Map(
    (workspacePayload?.result?.workspaces ?? [])
      .filter((workspace) => workspace?.workspace_id)
      .map((workspace) => [workspace.workspace_id, workspace]),
  );

  const builds = [...state.buildsByFingerprint.values()];
  await Promise.all(
    builds.map(async (build) => {
      if (!build?.paneId) {
        return;
      }

      const before = JSON.stringify(build);
      try {
        const payload = await runJsonCommand(pi, HERDR_BIN, ["pane", "get", build.paneId]);
        const pane = payload?.result?.pane;
        if (!pane) {
          build.liveStatus = "missing";
        } else {
          build.liveStatus = pane.agent_status || (pane.agent ? "starting" : "shell");
          build.sessionPath = pane.agent_session?.value ?? build.sessionPath;
          build.tabId = pane.tab_id ?? build.tabId;
          build.workspaceId = pane.workspace_id ?? build.workspaceId;
          build.workspaceLabel = workspacesById.get(build.workspaceId)?.label ?? build.workspaceLabel;
          build.terminalTitle = pane.terminal_title_stripped ?? build.terminalTitle;
        }
      } catch {
        build.liveStatus = "missing";
      }

      if (store && before !== JSON.stringify(build)) {
        store.saveBuild(build);
      }
    }),
  );
}

function formatSuggestionDetailLines(suggestion, build, width, theme) {
  if (!suggestion) {
    return [theme.fg("dim", "No suggestion selected.")];
  }

  const lines = [];
  const detailWidth = Math.max(24, width);
  lines.push(...wrapBlock(theme.bold(suggestion.title), detailWidth));
  lines.push(theme.fg("dim", `[${suggestion.fingerprint.slice(0, 8)}] ${suggestion.createdAt ?? ""}`.trim()));
  lines.push("");
  lines.push(...wrapBlock(theme.fg("muted", suggestion.summary), detailWidth));
  lines.push("");
  lines.push(...wrapBlock(`${theme.fg("accent", "Recommend:")} ${suggestion.recommendation}`, detailWidth));

  if (suggestion.payoff) {
    lines.push("");
    lines.push(...wrapBlock(`${theme.fg("success", "Payoff:")} ${suggestion.payoff}`, detailWidth));
  }
  if (suggestion.tradeoff) {
    lines.push(...wrapBlock(`${theme.fg("warning", "Tradeoff:")} ${suggestion.tradeoff}`, detailWidth));
  }
  if (suggestion.featureRefs?.length) {
    lines.push("");
    lines.push(...wrapBlock(`${theme.fg("accent", "Features:")} ${suggestion.featureRefs.join(", ")}`, detailWidth));
  }
  if (suggestion.sourceSessionPath) {
    lines.push(...wrapBlock(`${theme.fg("accent", "Source:")} ${suggestion.sourceSessionPath}`, detailWidth));
  }

  lines.push("");
  lines.push(theme.fg("accent", "Build state"));
  lines.push(...wrapBlock(`Status: ${buildStatusLabel(build)}`, detailWidth));
  if (build?.workspacePath) {
    lines.push(...wrapBlock(`Workspace: ${build.workspacePath}`, detailWidth));
  }
  if (build?.workspaceLabel || build?.workspaceId) {
    lines.push(...wrapBlock(`Herdr space: ${[build.workspaceLabel, build.workspaceId].filter(Boolean).join(" · ")}`, detailWidth));
  }
  if (build?.promptPath) {
    lines.push(...wrapBlock(`Prompt: ${build.promptPath}`, detailWidth));
  }
  if (build?.tabId || build?.paneId) {
    lines.push(...wrapBlock(`Herdr: ${[build.tabId, build.paneId].filter(Boolean).join(" · ")}`, detailWidth));
  }
  if (build?.sessionPath) {
    lines.push(...wrapBlock(`Pi session: ${build.sessionPath}`, detailWidth));
  }

  if (suggestion.evidence?.length) {
    lines.push("");
    lines.push(theme.fg("accent", "Evidence"));
    for (const item of suggestion.evidence) {
      lines.push(...wrapBlock(`• ${item.role} ${item.id}: ${item.quote}`, detailWidth));
    }
  }

  return lines;
}

function buildObserverPanel(ctx, state) {
  const theme = ctx.ui.theme;
  const suggestions = [...state.suggestions];
  let selectedIndex = 0;
  let detailOffset = 0;
  let maxDetailOffset = 0;

  return ctx.ui.custom((tui, _theme, _kb, done) => ({
    render(width) {
      const panelWidth = width;
      const innerWidth = Math.max(1, panelWidth - 4);
      const listWidth = suggestions.length > 0 ? Math.max(1, Math.min(52, Math.floor(innerWidth * 0.32))) : 0;
      const detailWidth = suggestions.length > 0 ? innerWidth - listWidth - 3 : innerWidth;
      const selected = suggestions[selectedIndex];
      const selectedBuild = selected ? state.buildsByFingerprint.get(selected.fingerprint) : undefined;

      const header = truncateToWidth(theme.fg("accent", theme.bold(" Workflow Observer ")) + theme.fg("dim", " detailed panel"), innerWidth);
      const summary = truncateToWidth(
        theme.fg("dim", `${state.enabled ? "on" : "off"} · ${suggestions.length} pending · ↑↓ move · pgup/pgdn scroll · b build (workflow resource candidates may activate globally after checks) · d dismiss · esc close`),
        innerWidth,
      );

      const leftLines = suggestions.length === 0
        ? [theme.fg("dim", "No pending suggestions."), theme.fg("dim", "Run /observer run after more session activity.")]
        : suggestions.map((suggestion, index) => {
            const build = state.buildsByFingerprint.get(suggestion.fingerprint);
            const prefix = index === selectedIndex ? theme.fg("accent", "›") : theme.fg("dim", " ");
            const buildMarker = build?.liveStatus === "working"
              ? theme.fg("success", "●")
              : build
                ? theme.fg("warning", "◌")
                : theme.fg("dim", "·");
            const label = `${prefix} ${buildMarker} ${suggestion.title} [${suggestion.fingerprint.slice(0, 8)}]`;
            return truncateToWidth(label, listWidth);
          });

      const rightLines = formatSuggestionDetailLines(selected, selectedBuild, detailWidth, theme);
      const bodyHeight = Math.max(1, Math.floor(tui.terminal.rows * 0.85) - 5);
      maxDetailOffset = Math.max(0, rightLines.length - bodyHeight);
      detailOffset = Math.min(detailOffset, maxDetailOffset);
      const listOffset = Math.max(0, selectedIndex - bodyHeight + 1);
      const lines = [];

      lines.push(theme.fg("border", `╭${"─".repeat(innerWidth + 2)}╮`));
      lines.push(theme.fg("border", "│ ") + header + " ".repeat(Math.max(0, innerWidth - visibleWidth(header))) + theme.fg("border", " │"));
      lines.push(theme.fg("border", "│ ") + summary + " ".repeat(Math.max(0, innerWidth - visibleWidth(summary))) + theme.fg("border", " │"));
      lines.push(theme.fg("border", `├${"─".repeat(innerWidth + 2)}┤`));

      for (let i = 0; i < bodyHeight; i += 1) {
        const left = suggestions.length === 0 ? "" : (leftLines[i + listOffset] ?? "");
        const right = rightLines[i + detailOffset] ?? "";
        const middle = suggestions.length === 0
          ? truncateToWidth(right, innerWidth)
          : `${truncateToWidth(left, listWidth)}${" ".repeat(Math.max(0, listWidth - visibleWidth(left)))} ${theme.fg("border", "│")} ${truncateToWidth(right, detailWidth)}`;
        const content = truncateToWidth(middle, innerWidth);
        lines.push(theme.fg("border", "│ ") + content + " ".repeat(Math.max(0, innerWidth - visibleWidth(content))) + theme.fg("border", " │"));
      }

      lines.push(theme.fg("border", `╰${"─".repeat(innerWidth + 2)}╯`));
      return lines;
    },
    handleInput(data) {
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "enter")) {
        done(undefined);
        return;
      }
      if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
        detailOffset = Math.max(0, Math.min(maxDetailOffset, detailOffset + (matchesKey(data, "pageUp") ? -10 : 10)));
        tui.requestRender();
        return;
      }
      if (matchesKey(data, "up") && selectedIndex > 0) {
        selectedIndex -= 1;
        detailOffset = 0;
        tui.requestRender();
        return;
      }
      if (matchesKey(data, "down") && selectedIndex < suggestions.length - 1) {
        selectedIndex += 1;
        detailOffset = 0;
        tui.requestRender();
        return;
      }
      if ((data === "d" || data === "D") && suggestions[selectedIndex]) {
        done({ type: "dismiss", fingerprint: suggestions[selectedIndex].fingerprint });
        return;
      }
      if ((data === "b" || data === "B") && suggestions[selectedIndex]) {
        done({ type: "build", fingerprint: suggestions[selectedIndex].fingerprint });
      }
    },
    invalidate() {},
  }), { overlay: true, overlayOptions: { width: "85%", maxHeight: "85%" } });
}

export default function workflowObserver(pi) {
  const config = loadConfig();
  const store = openObserverStore(config);

  try {
    store.pruneResolved();
  } catch {
    // Ignore startup prune failures and keep the observer available.
  }

  let currentCtx;
  let state = defaultObserverState(config);
  let phase = "idle";
  let activeReview;

  function refreshState(ctx, sessionManager = ctx?.sessionManager) {
    state = store.loadState({ sessionKey: getSessionKey(sessionManager) });
    updateUi(ctx);
    return state;
  }

  function updateUi(ctx) {
    if (!ctx?.hasUI) {
      return;
    }

    const theme = ctx.ui.theme;
    ctx.ui.setStatus(config.statusKey, renderStatus(theme, state, phase));
    if (config.showWidget) {
      const widgetLines = buildWidgetLines(theme, state, phase);
      ctx.ui.setWidget(config.statusKey, widgetLines, widgetLines ? { placement: "belowEditor" } : undefined);
    }
  }

  async function ensureBuildTarget(sourceProjectPath, tabLabel) {
    const workspacePayload = await runJsonCommand(pi, HERDR_BIN, ["workspace", "list"]);
    const existingWorkspace = findDedicatedBuildWorkspace(workspacePayload?.result?.workspaces);
    if (existingWorkspace?.workspace_id) {
      const tabPayload = await runJsonCommand(pi, HERDR_BIN, [
        "tab",
        "create",
        "--workspace",
        existingWorkspace.workspace_id,
        "--cwd",
        sourceProjectPath,
        "--label",
        tabLabel,
        "--no-focus",
      ]);

      const tab = tabPayload?.result?.tab;
      const rootPane = tabPayload?.result?.root_pane;
      if (!tab?.tab_id || !rootPane?.pane_id) {
        throw new Error("Herdr did not return a tab or root pane for the observer build.");
      }

      return {
        workspaceId: existingWorkspace.workspace_id,
        workspaceLabel: existingWorkspace.label ?? OBSERVER_BUILD_WORKSPACE_LABEL,
        tabId: tab.tab_id,
        paneId: rootPane.pane_id,
        createdWorkspace: false,
      };
    }

    const createPayload = await runJsonCommand(pi, HERDR_BIN, [
      "workspace",
      "create",
      "--cwd",
      sourceProjectPath,
      "--label",
      OBSERVER_BUILD_WORKSPACE_LABEL,
      "--no-focus",
    ]);

    const workspace = createPayload?.result?.workspace;
    const tab = createPayload?.result?.tab;
    const rootPane = createPayload?.result?.root_pane;
    if (!workspace?.workspace_id || !tab?.tab_id || !rootPane?.pane_id) {
      throw new Error("Herdr did not return a workspace, tab, or root pane for the observer build.");
    }

    return {
      workspaceId: workspace.workspace_id,
      workspaceLabel: workspace.label ?? OBSERVER_BUILD_WORKSPACE_LABEL,
      tabId: tab.tab_id,
      paneId: rootPane.pane_id,
      createdWorkspace: true,
    };
  }

  async function buildSuggestion(ctx, fingerprint) {
    refreshState(ctx);
    await refreshBuildStatuses(pi, state, store).catch(() => undefined);
    const suggestion = state.suggestions.find((item) => item.fingerprint === fingerprint);
    if (!suggestion) {
      notify(ctx, `Suggestion ${fingerprint.slice(0, 8)} no longer exists.`, "warning");
      return;
    }

    let sourceProjectPath;
    try {
      sourceProjectPath = resolveObserverProjectPath(suggestion.projectPath);
    } catch {
      notify(ctx, "Build launch refused: suggestion has no valid recorded source project.", "warning");
      return;
    }

    const existingBuild = state.buildsByFingerprint.get(fingerprint);
    if (existingBuild?.tabId && existingBuild.liveStatus && existingBuild.liveStatus !== "missing") {
      if (process.env.HERDR_ENV === "1") {
        await pi.exec(HERDR_BIN, ["tab", "focus", existingBuild.tabId], { timeout: 30_000 }).catch(() => undefined);
        notify(ctx, `Focused existing build for ${fingerprint.slice(0, 8)}.`, "info");
        return;
      }
    }

    if (process.env.HERDR_ENV !== "1") {
      notify(ctx, "Build launch requires Herdr in this prototype.", "warning");
      return;
    }

    let targetKind = suggestion.targetKind ?? "source-project";
    if (ctx.hasUI) {
      const choice = await ctx.ui.select("Choose build target and impact", ["Recorded source project only", "Global workflow-resource candidate (new tasks after checks)"]);
      if (!choice) return;
      targetKind = choice.startsWith("Global") ? "workflow-resource" : "source-project";
    }
    const candidateRequest = {
      targetKind,
      approvedBy: "observer-ui-build-action",
      fingerprint,
      title: suggestion.title,
      summary: suggestion.summary,
      recommendation: suggestion.recommendation,
      sourceProjectPath,
    };
    try { pi.events.emit("workflow:candidate-build-request", candidateRequest); } catch { /* Candidate support is optional; keep the ordinary observer build available. */ }
    if (targetKind === "workflow-resource" && !candidateRequest.result) {
      notify(ctx, `Workflow candidate could not be prepared: ${candidateRequest.error ?? "candidate controller unavailable"}`, "warning");
      return;
    }
    if (candidateRequest.eligible && candidateRequest.error) {
      notify(ctx, `Workflow candidate could not be prepared: ${candidateRequest.error}`, "warning");
      return;
    }
    const candidate = candidateRequest.result;
    let workspacePath = candidate?.candidateRoot;
    let requestsPath;
    if (workspacePath) {
      requestsPath = path.join(workspacePath, ".observer-requests");
      fs.mkdirSync(requestsPath, { recursive: true });
    } else {
      ({ workspacePath, requestsPath } = ensureObserverWorkspace(sourceProjectPath));
    }
    const promptPath = path.join(requestsPath, `${fingerprint.slice(0, 8)}.md`);

    const build = {
      fingerprint,
      title: suggestion.title,
      workspacePath,
      promptPath,
      candidateId: candidate?.candidateId,
      targetKind,
      sourceProjectPath,
      requestedAt: new Date().toISOString(),
      status: "launched",
      liveStatus: "starting",
    };

    fs.writeFileSync(promptPath, buildPromptText(suggestion, build, sourceProjectPath), "utf8");

    const buildTargetPath = candidate ? workspacePath : sourceProjectPath;
    build.buildTargetPath = buildTargetPath;
    Object.assign(build, await ensureBuildTarget(buildTargetPath, `Observer build · ${fingerprint.slice(0, 8)}`));

    const sessionName = `Observer build: ${suggestion.title}`;
    const command = [
      `cd ${shellQuote(buildTargetPath)}`,
      `pi --name ${shellQuote(sessionName)} @${shellQuote(promptPath)}`,
    ].join(" && ");

    await pi.exec(HERDR_BIN, ["pane", "run", build.paneId, command], { timeout: 30_000 });
    store.markInProgress(fingerprint);
    store.saveBuild(build);
    refreshState(ctx);
    await refreshBuildStatuses(pi, state, store).catch(() => undefined);
    updateUi(ctx);
    notify(
      ctx,
      `${build.createdWorkspace ? "Created" : "Opened"} observer build for ${fingerprint.slice(0, 8)} in ${build.workspaceLabel}.`,
      "info",
    );
  }

  async function openObserverPanel(ctx) {
    if (ctx.mode !== "tui") {
      notify(ctx, "/observer open requires TUI mode.", "warning");
      return;
    }

    refreshState(ctx);
    await refreshBuildStatuses(pi, state, store).catch(() => undefined);
    updateUi(ctx);

    while (true) {
      const result = await buildObserverPanel(ctx, state);
      if (!result) {
        return;
      }

      if (result.type === "dismiss") {
        store.markDismissed(result.fingerprint);
        refreshState(ctx);
        await refreshBuildStatuses(pi, state, store).catch(() => undefined);
        updateUi(ctx);
        notify(ctx, `Dismissed ${result.fingerprint.slice(0, 8)}.`, "info");
        continue;
      }

      if (result.type === "build") {
        await buildSuggestion(ctx, result.fingerprint);
        await refreshBuildStatuses(pi, state, store).catch(() => undefined);
        updateUi(ctx);
        continue;
      }
    }
  }

  function cancelReview(reason = "cancelled") {
    if (activeReview?.controller) {
      activeReview.controller.abort(reason);
    }
    activeReview = undefined;
    phase = "idle";
    if (currentCtx) {
      updateUi(currentCtx);
    }
  }

  async function persistSuggestions(projectPath, suggestions, sourceSessionPath) {
    store.upsertSuggestions({
      suggestions: suggestions.slice(0, config.maxSuggestionsPerRun),
      projectPath,
      sourceSessionPath,
    });
  }

  async function runReview(ctx, options = {}) {
    if (phase === "reviewing") {
      return { started: false, reason: "review already running" };
    }

    const manager = options.sessionPath ? loadExplicitSession(options.sessionPath) : ctx.sessionManager;
    const sessionPath = getSessionPath(manager) ?? options.sessionPath ?? undefined;
    const sessionKey = getSessionKey(manager);
    const reviewState = store.loadState({ sessionKey });
    const messages = entriesToMessages(manager.getBranch());
    const decision = options.force
      ? { shouldRun: true, reason: "forced", newMessages: messages.length }
      : decideCheckpoint({ messages, state: reviewState, config });

    if (!decision.shouldRun) {
      return { started: false, reason: decision.reason };
    }

    phase = "reviewing";
    const controller = new AbortController();
    activeReview = { controller };
    updateUi(ctx);

    try {
      const projectPath = resolveObserverProjectPath(ctx.cwd);
      const suggestions = analyzeConversation(messages, reviewState, config, { projectPath })
        .slice(0, config.maxSuggestionsPerRun);
      if (controller.signal.aborted) {
        return { started: false, reason: "cancelled" };
      }

      await persistSuggestions(projectPath, suggestions, sessionPath);
      store.saveCheckpoint({
        sessionKey,
        sessionPath,
        lastCursorMessageId: messages.at(-1)?.id,
        reviewedAt: new Date().toISOString(),
        reason: suggestions.length ? "suggestions" : "clean",
      });

      refreshState(ctx);
      if (suggestions.length) {
        notify(ctx, `Workflow observer: ${suggestions.length} suggestion(s) ready. Use /observer open.`, "info");
      }

      return { started: true, reason: suggestions.length ? "suggestions" : "clean", suggestions };
    } finally {
      activeReview = undefined;
      phase = "idle";
      updateUi(ctx);
    }
  }

  registerWorkflowEvidenceListener(pi, store);

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    try {
      store.pruneResolved();
    } catch {
      // Ignore prune failures during session bootstrap.
    }
    refreshState(ctx);
    await refreshBuildStatuses(pi, state, store).catch(() => undefined);
    updateUi(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    currentCtx = ctx;
    refreshState(ctx);
    await refreshBuildStatuses(pi, state, store).catch(() => undefined);
    updateUi(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    cancelReview("session shutdown");
    if (ctx?.hasUI) {
      ctx.ui.setStatus(config.statusKey, undefined);
      ctx.ui.setWidget(config.statusKey, undefined);
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    currentCtx = ctx;
    refreshState(ctx);
    await refreshBuildStatuses(pi, state, store).catch(() => undefined);
    if (!state.enabled || phase === "reviewing") {
      return;
    }

    await runReview(ctx).catch((error) => {
      notify(ctx, `Workflow observer failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  });

  pi.registerCommand("observer", {
    description: "Manage the local workflow observer prototype",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      refreshState(ctx);
      await refreshBuildStatuses(pi, state, store).catch(() => undefined);
      const [command = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const remainder = rest.join(" ").trim();

      switch (command) {
        case "status":
        case "": {
          notify(ctx, formatStatusText(state, phase), "info");
          return;
        }

        case "on": {
          store.setEnabled(true);
          refreshState(ctx);
          notify(ctx, "Workflow observer enabled.", "info");
          return;
        }

        case "off": {
          cancelReview("disabled");
          store.setEnabled(false);
          refreshState(ctx);
          notify(ctx, "Workflow observer disabled.", "info");
          return;
        }

        case "cancel": {
          cancelReview("cancelled by user");
          notify(ctx, "Workflow observer review cancelled.", "info");
          return;
        }

        case "run": {
          const result = await runReview(ctx, {
            force: true,
            sessionPath: remainder || undefined,
          }).catch((error) => ({
            started: false,
            reason: error instanceof Error ? error.message : String(error),
          }));

          notify(ctx, `Workflow observer run: ${result.reason}`, result.started ? "info" : "warning");
          return;
        }

        case "list": {
          const lines = formatSuggestionLines(state.suggestions);
          notify(ctx, lines.join("\n"), "info");
          return;
        }

        case "open": {
          await openObserverPanel(ctx);
          return;
        }

        case "build": {
          const fingerprint = resolveSuggestionFingerprint(state, remainder);
          if (!fingerprint) {
            notify(ctx, "Usage: /observer build <suggestion-id-prefix>", "warning");
            return;
          }
          await buildSuggestion(ctx, fingerprint);
          return;
        }

        case "dismiss": {
          const fingerprint = resolveSuggestionFingerprint(state, remainder);
          if (!fingerprint) {
            notify(ctx, "Usage: /observer dismiss <suggestion-id-prefix>", "warning");
            return;
          }
          store.markDismissed(fingerprint);
          refreshState(ctx);
          notify(ctx, `Dismissed ${fingerprint.slice(0, 8)}.`, "info");
          return;
        }

        case "done": {
          const fingerprint = resolveSuggestionFingerprint(state, remainder);
          if (!fingerprint) {
            notify(ctx, "Usage: /observer done <suggestion-id-prefix>", "warning");
            return;
          }
          store.markWorked(fingerprint);
          refreshState(ctx);
          notify(ctx, `Marked ${fingerprint.slice(0, 8)} worked.`, "info");
          return;
        }

        case "help":
        default: {
          notify(
            ctx,
            [
              "Usage: /observer <status|on|off|run|list|open|build|dismiss|done|cancel>",
              "  /observer run                review current session",
              "  /observer run /abs/path      review another session by explicit path",
              "  /observer list               list pending suggestions",
              "  /observer open               open the detailed suggestion panel",
              "  /observer build <id>         launch or focus a build session for one suggestion",
              "  /observer dismiss <id>       dismiss one suggestion",
              "  /observer done <id>          mark one suggestion completed/worked",
            ].join("\n"),
            command === "help" ? "info" : "warning",
          );
        }
      }
    },
  });
}
