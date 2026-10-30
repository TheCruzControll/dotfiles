import crypto from "node:crypto";

export const FEATURE_CATALOG = {
  todo: {
    label: "todo",
    note: "Track explicit work items and completion state.",
  },
  askUserQuestion: {
    label: "ask_user_question",
    note: "Collect missing decisions in one structured prompt instead of ad hoc clarifications.",
  },
  handoff: {
    label: "handoff / restart prompt",
    note: "Create a concise restart artifact when work gets long or interrupted.",
  },
  statusUi: {
    label: "status line + widget",
    note: "Show active mode and pending follow-up without extra chat turns.",
  },
  projectContext: {
    label: "project context / skill",
    note: "Keep approved defaults and scope boundaries local to the project.",
  },
  checkpoints: {
    label: "agent_settled checkpoint",
    note: "Review only after a settled run, not on every edit.",
  },
};

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

export function extractTextContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function entriesToMessages(entries) {
  return entries
    .flatMap((entry) => {
      if (!entry || entry.type !== "message" || !entry.message) {
        return [];
      }

      const role = entry.message.role;
      if (role !== "user" && role !== "assistant") {
        return [];
      }

      const text = extractTextContent(entry.message.content);
      if (!text) {
        return [];
      }

      return [
        {
          id: entry.id,
          role,
          text,
          timestamp: entry.timestamp,
        },
      ];
    })
    .filter(Boolean);
}

export function sliceRecentMessages(messages, maxMessages) {
  if (!Array.isArray(messages) || messages.length <= maxMessages) {
    return messages ?? [];
  }
  return messages.slice(-maxMessages);
}

export function countMessagesSinceCursor(messages, cursorMessageId) {
  if (!cursorMessageId) {
    return messages.length;
  }

  const cursorIndex = messages.findIndex((message) => message.id === cursorMessageId);
  if (cursorIndex < 0) {
    return messages.length;
  }

  return Math.max(0, messages.length - cursorIndex - 1);
}

export function decideCheckpoint({ messages, state, config, now = Date.now() }) {
  if (!state?.enabled) {
    return { shouldRun: false, reason: "observer disabled", newMessages: 0 };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { shouldRun: false, reason: "no transcript text", newMessages: 0 };
  }

  const newMessages = countMessagesSinceCursor(messages, state.lastCheckpoint?.cursorMessageId);
  if (newMessages < config.minNewMessages) {
    return {
      shouldRun: false,
      reason: `waiting for activity (${newMessages}/${config.minNewMessages} new messages)`,
      newMessages,
    };
  }

  const reviewedAt = state.lastCheckpoint?.reviewedAt ? Date.parse(state.lastCheckpoint.reviewedAt) : undefined;
  if (Number.isFinite(reviewedAt) && now - reviewedAt < config.cooldownMs) {
    const remainingMs = Math.max(0, config.cooldownMs - (now - reviewedAt));
    return {
      shouldRun: false,
      reason: `cooldown active (${Math.ceil(remainingMs / 60000)}m remaining)`,
      newMessages,
    };
  }

  const userMessages = messages.filter((message) => message.role === "user");
  if (userMessages.length === 0) {
    return { shouldRun: false, reason: "no user messages", newMessages };
  }

  return { shouldRun: true, reason: "ready", newMessages };
}

function quote(message) {
  const compact = message.text.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function pickEvidence(messages, predicate, limit = 2) {
  return messages.filter(predicate).slice(-limit).map((message) => ({ id: message.id, role: message.role, quote: quote(message) }));
}

function lowerMessages(messages) {
  return messages.map((message) => ({ ...message, lower: message.text.toLowerCase() }));
}

export function suggestionIdentity(suggestion, projectPath = suggestion.projectPath) {
  return sha1(JSON.stringify({
    projectPath: projectPath ?? null,
    ruleId: suggestion.ruleId,
    recommendation: suggestion.recommendation.trim().replace(/\s+/g, " ").toLowerCase(),
  }));
}

function addSuggestion(output, state, suggestion, projectPath) {
  const fingerprint = suggestionIdentity(suggestion, projectPath);

  if (
    state?.seenFingerprints?.has(fingerprint)
    || state?.suppressedFingerprints?.has(fingerprint)
    || state?.dismissedFingerprints?.has(fingerprint)
  ) {
    return;
  }

  output.push({
    ...suggestion,
    fingerprint,
    createdAt: new Date().toISOString(),
  });
}

export function analyzeConversation(messages, state, config, options = {}) {
  const recent = lowerMessages(sliceRecentMessages(messages, config.maxMessages));
  const suggestions = [];
  const projectPath = options.projectPath ?? state?.projectPath ?? null;

  const userMessages = recent.filter((message) => message.role === "user");
  const assistantMessages = recent.filter((message) => message.role === "assistant");

  const scopeCorrections = userMessages.filter((message) =>
    /(separate|independent|not part of|do not|don't|stop|remove|keep .* unchanged|this project|its own todo|leave .* unchanged|pi-only)/i.test(
      message.text,
    ),
  );
  if (scopeCorrections.length >= 2) {
    addSuggestion(suggestions, state, {
      ruleId: "scope-boundary",
      title: "Pin the project boundary",
      summary: "Recent messages include repeated scope or ownership corrections.",
      recommendation:
        "Propose a short project-local boundary note or approved handoff file after the second correction, so later turns reuse it instead of rediscovering it.",
      payoff: "Less drift into the wrong repo, runtime, or approval scope.",
      tradeoff: "Adds a small upfront note before implementation continues.",
      featureRefs: [FEATURE_CATALOG.projectContext.label, FEATURE_CATALOG.handoff.label],
      evidence: pickEvidence(scopeCorrections, () => true),
    }, projectPath);
  }

  const continuePrompts = userMessages.filter((message) => /^(ok )?(continue|keep going|keep on continuing)|continue in this session/i.test(message.text));
  if (continuePrompts.length >= 3) {
    addSuggestion(suggestions, state, {
      ruleId: "continuation-loop",
      title: "Batch progress at checkpoints",
      summary: "The user had to send multiple short continuation prompts to keep long work moving.",
      recommendation:
        "Use explicit checkpoint updates tied to settled runs: keep the todo current, surface status in the UI, and wait to interrupt only when a real decision or blocker appears.",
      payoff: "Fewer 'continue' turns and clearer autonomous progress.",
      tradeoff: "Progress reports become less frequent and more batched.",
      featureRefs: [FEATURE_CATALOG.todo.label, FEATURE_CATALOG.statusUi.label, FEATURE_CATALOG.checkpoints.label],
      evidence: pickEvidence(continuePrompts, () => true),
    }, projectPath);
  }

  const testHeavyAssistant = assistantMessages.filter((message) =>
    /(tests?|typecheck|integration|unit|passed|green|suite)/i.test(message.text),
  );
  const testConcern = userMessages.filter((message) => /(too many tests|so many tests|token|context)/i.test(message.text));
  if (testHeavyAssistant.length >= 3 && testConcern.length >= 1) {
    addSuggestion(suggestions, state, {
      ruleId: "validation-focus",
      title: "Prefer milestone validation",
      summary: "The thread spent noticeable effort on broad test reporting before the user asked why so much testing was happening.",
      recommendation:
        "Start with focused acceptance checks for the active change, then reserve large upstream suites for milestone gates or cutover decisions.",
      payoff: "Faster feedback and less context spent on repetitive pass counts.",
      tradeoff: "Broader regressions may surface later in the milestone cycle.",
      featureRefs: [FEATURE_CATALOG.todo.label, FEATURE_CATALOG.statusUi.label],
      evidence: [...pickEvidence(testHeavyAssistant, () => true, 1), ...pickEvidence(testConcern, () => true, 1)],
    }, projectPath);
  }

  const handoffMentions = recent.filter((message) => /(handoff|restart prompt|resume|interrupted|new session)/i.test(message.text));
  if (handoffMentions.length >= 2) {
    addSuggestion(suggestions, state, {
      ruleId: "handoff-timing",
      title: "Create handoffs earlier",
      summary: "The workflow includes interruptions and restart artifacts, but only after context grew large.",
      recommendation:
        "Offer a handoff doc or restart prompt once work becomes long-running, branchy, or likely to cross sessions, instead of waiting until the end.",
      payoff: "Shorter recovery time when work pauses or moves to a new session.",
      tradeoff: "Requires lightweight documentation before the task is fully done.",
      featureRefs: [FEATURE_CATALOG.handoff.label, FEATURE_CATALOG.todo.label],
      evidence: pickEvidence(handoffMentions, () => true),
    }, projectPath);
  }

  const stablePreferenceMessages = userMessages.filter((message) => /(dark mode|by default|everything in pi|pi-only|always)/i.test(message.text));
  if (stablePreferenceMessages.length >= 1) {
    addSuggestion(suggestions, state, {
      ruleId: "stable-preferences",
      title: "Capture durable defaults locally",
      summary: "At least one message sets a recurring preference that will probably matter again.",
      recommendation:
        "After approval, capture durable defaults in a project-local skill or context note instead of relying on fresh natural-language reminders.",
      payoff: "Fewer repeated preference reminders across sessions.",
      tradeoff: "Needs explicit approval and careful local scoping.",
      featureRefs: [FEATURE_CATALOG.projectContext.label, FEATURE_CATALOG.askUserQuestion.label],
      evidence: pickEvidence(stablePreferenceMessages, () => true),
    }, projectPath);
  }

  return suggestions.slice(0, 5);
}

export function formatSuggestionLines(suggestions) {
  if (!suggestions.length) {
    return ["No suggestions recorded yet."];
  }

  return suggestions.flatMap((suggestion) => {
    const evidence = suggestion.evidence?.map((item) => `    • ${item.role} ${item.id}: ${item.quote}`) ?? [];
    const sourceLine = suggestion.sourceSessionPath ? `  Source: ${suggestion.sourceSessionPath}` : undefined;
    return [
      `- ${suggestion.title} [${suggestion.fingerprint.slice(0, 8)}]`,
      `  ${suggestion.summary}`,
      `  Recommend: ${suggestion.recommendation}`,
      `  Features: ${suggestion.featureRefs.join(", ")}`,
      sourceLine,
      ...evidence,
    ].filter(Boolean);
  });
}
