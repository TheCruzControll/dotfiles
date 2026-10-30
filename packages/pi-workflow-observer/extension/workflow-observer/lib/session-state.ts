export const OBSERVER_ENTRY_TYPE = "workflow-observer";

export function defaultObserverState(config = {}) {
  const suppressedFingerprints = new Set();
  return {
    enabled: config.enabled !== false,
    suggestions: [],
    seenFingerprints: new Set(),
    dismissedFingerprints: suppressedFingerprints,
    suppressedFingerprints,
    buildsByFingerprint: new Map(),
    lastCheckpoint: undefined,
  };
}

export function reconstructObserverState(branchEntries, config = {}) {
  const state = defaultObserverState(config);
  const suggestionsByFingerprint = new Map();

  for (const entry of branchEntries ?? []) {
    if (entry?.type !== "custom" || entry.customType !== OBSERVER_ENTRY_TYPE || !entry.data) {
      continue;
    }

    const data = entry.data;
    switch (data.action) {
      case "settings": {
        if (typeof data.enabled === "boolean") {
          state.enabled = data.enabled;
        }
        break;
      }
      case "suggestion": {
        const suggestion = data.suggestion;
        if (suggestion?.fingerprint) {
          state.seenFingerprints.add(suggestion.fingerprint);
          suggestionsByFingerprint.set(suggestion.fingerprint, suggestion);
        }
        break;
      }
      case "dismiss": {
        if (data.fingerprint) {
          state.dismissedFingerprints.add(data.fingerprint);
          suggestionsByFingerprint.delete(data.fingerprint);
        }
        break;
      }
      case "checkpoint": {
        if (!data.sourceSessionPath) {
          state.lastCheckpoint = {
            cursorMessageId: data.cursorMessageId,
            reviewedAt: data.reviewedAt,
            reason: data.reason,
          };
        }
        break;
      }
      case "build": {
        const build = data.build;
        if (build?.fingerprint) {
          state.buildsByFingerprint.set(build.fingerprint, build);
        }
        break;
      }
      default:
        break;
    }
  }

  state.suggestions = [...suggestionsByFingerprint.values()]
    .filter((suggestion) => !state.dismissedFingerprints.has(suggestion.fingerprint))
    .sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0));

  return state;
}

export function resolveSuggestionFingerprint(state, token) {
  if (!token) {
    return undefined;
  }

  const exact = state.suggestions.find((suggestion) => suggestion.fingerprint === token);
  if (exact) {
    return exact.fingerprint;
  }

  const prefixMatches = state.suggestions.filter((suggestion) => suggestion.fingerprint.startsWith(token));
  if (prefixMatches.length === 1) {
    return prefixMatches[0].fingerprint;
  }

  return undefined;
}
