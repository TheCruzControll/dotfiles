import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { suggestionIdentity } from "./analyzer.ts";
import { normalizeWorkflowEvidence } from "./workflow-evidence.ts";

const DEFAULT_STORE_PATH = "~/.pi/observer/global-observer.sqlite";
const ACTIVE_STATUSES = new Set(["active", "in_progress"]);
const SUPPRESSED_STATUSES = new Set(["dismissed", "worked"]);

function nowIso() {
  return new Date().toISOString();
}

function expandHome(inputPath) {
  if (!inputPath || inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeSuggestionRow(row) {
  return {
    fingerprint: row.fingerprint,
    projectPath: row.project_path,
    ruleId: row.rule_id,
    title: row.title,
    summary: row.summary,
    recommendation: row.recommendation,
    payoff: row.payoff ?? undefined,
    tradeoff: row.tradeoff ?? undefined,
    featureRefs: parseJson(row.feature_refs_json, []),
    evidence: parseJson(row.evidence_json, []),
    createdAt: row.first_seen_at,
    updatedAt: row.last_seen_at,
    sourceSessionPath: row.last_source_session_path ?? undefined,
    status: row.status,
    occurrences: row.occurrences,
  };
}

function normalizeBuildRow(row) {
  return {
    fingerprint: row.fingerprint,
    status: row.status,
    liveStatus: row.live_status ?? undefined,
    workspacePath: row.workspace_path ?? undefined,
    promptPath: row.prompt_path ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    workspaceLabel: row.workspace_label ?? undefined,
    tabId: row.tab_id ?? undefined,
    paneId: row.pane_id ?? undefined,
    sessionPath: row.session_path ?? undefined,
    terminalTitle: row.terminal_title ?? undefined,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
  };
}

function withTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openObserverStore(config = {}) {
  const resolvedRetentionDays = Number.isFinite(config.resolvedRetentionDays)
    ? Math.max(0, Math.trunc(config.resolvedRetentionDays))
    : 30;
  const storePath = path.resolve(expandHome(config.storePath ?? DEFAULT_STORE_PATH));

  fs.mkdirSync(path.dirname(storePath), { recursive: true });

  const db = new DatabaseSync(storePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS observer_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_checkpoints (
      session_key TEXT PRIMARY KEY,
      session_path TEXT,
      last_cursor_message_id TEXT,
      reviewed_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      fingerprint TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      payoff TEXT,
      tradeoff TEXT,
      feature_refs_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'in_progress', 'dismissed', 'worked')),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_source_session_path TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1,
      resolved_at TEXT,
      resolution_note TEXT
    );

    CREATE INDEX IF NOT EXISTS suggestions_status_idx
      ON suggestions(status, last_seen_at DESC);

    CREATE INDEX IF NOT EXISTS suggestions_project_status_idx
      ON suggestions(project_path, status, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS builds (
      fingerprint TEXT PRIMARY KEY REFERENCES suggestions(fingerprint) ON DELETE CASCADE,
      status TEXT NOT NULL,
      live_status TEXT,
      workspace_path TEXT,
      prompt_path TEXT,
      workspace_id TEXT,
      workspace_label TEXT,
      tab_id TEXT,
      pane_id TEXT,
      session_path TEXT,
      terminal_title TEXT,
      requested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suggestion_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL REFERENCES suggestions(fingerprint) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN (
        'observed',
        'updated',
        'dismissed',
        'build_started',
        'build_updated',
        'worked',
        'reactivated'
      )),
      at TEXT NOT NULL,
      source_session_path TEXT,
      payload_json TEXT
    );

    CREATE INDEX IF NOT EXISTS suggestion_events_fingerprint_idx
      ON suggestion_events(fingerprint, at DESC);

    CREATE TABLE IF NOT EXISTS workflow_evidence (
      event_id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      project_path TEXT NOT NULL,
      session_anchor TEXT NOT NULL,
      task_id TEXT NOT NULL,
      workflow_revision TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      event_type TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS workflow_evidence_project_task_idx
      ON workflow_evidence(project_path, task_id, recorded_at);
  `);

  const statements = {
    getSetting: db.prepare(`SELECT value_json FROM observer_settings WHERE key = ?`),
    upsertSetting: db.prepare(`
      INSERT INTO observer_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `),
    getCheckpoint: db.prepare(`
      SELECT session_key, session_path, last_cursor_message_id, reviewed_at, reason
      FROM session_checkpoints
      WHERE session_key = ?
    `),
    upsertCheckpoint: db.prepare(`
      INSERT INTO session_checkpoints (
        session_key,
        session_path,
        last_cursor_message_id,
        reviewed_at,
        reason,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        session_path = excluded.session_path,
        last_cursor_message_id = excluded.last_cursor_message_id,
        reviewed_at = excluded.reviewed_at,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `),
    selectSuggestion: db.prepare(`
      SELECT *
      FROM suggestions
      WHERE fingerprint = ?
    `),
    insertSuggestion: db.prepare(`
      INSERT INTO suggestions (
        fingerprint,
        project_path,
        rule_id,
        title,
        summary,
        recommendation,
        payoff,
        tradeoff,
        feature_refs_json,
        evidence_json,
        status,
        first_seen_at,
        last_seen_at,
        last_source_session_path,
        occurrences,
        resolved_at,
        resolution_note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `),
    updateSuggestionActive: db.prepare(`
      UPDATE suggestions
      SET project_path = ?,
          rule_id = ?,
          title = ?,
          summary = ?,
          recommendation = ?,
          payoff = ?,
          tradeoff = ?,
          feature_refs_json = ?,
          evidence_json = ?,
          last_seen_at = ?,
          last_source_session_path = ?,
          occurrences = occurrences + 1,
          resolution_note = NULL,
          resolved_at = NULL
      WHERE fingerprint = ?
    `),
    updateSuggestionSuppressed: db.prepare(`
      UPDATE suggestions
      SET project_path = ?,
          rule_id = ?,
          title = ?,
          summary = ?,
          recommendation = ?,
          payoff = ?,
          tradeoff = ?,
          feature_refs_json = ?,
          evidence_json = ?,
          last_seen_at = ?,
          last_source_session_path = ?,
          occurrences = occurrences + 1
      WHERE fingerprint = ?
    `),
    selectVisibleSuggestions: db.prepare(`
      SELECT *
      FROM suggestions
      WHERE status IN ('active', 'in_progress')
      ORDER BY last_seen_at DESC, first_seen_at DESC
    `),
    selectBuilds: db.prepare(`SELECT * FROM builds`),
    selectAllFingerprints: db.prepare(`SELECT * FROM suggestions`),
    resolveSuggestion: db.prepare(`
      UPDATE suggestions
      SET status = ?,
          resolved_at = ?,
          resolution_note = ?,
          last_seen_at = ?
      WHERE fingerprint = ?
    `),
    markInProgress: db.prepare(`
      UPDATE suggestions
      SET status = 'in_progress',
          last_seen_at = ?
      WHERE fingerprint = ?
        AND status = 'active'
    `),
    selectBuild: db.prepare(`SELECT * FROM builds WHERE fingerprint = ?`),
    upsertBuild: db.prepare(`
      INSERT INTO builds (
        fingerprint,
        status,
        live_status,
        workspace_path,
        prompt_path,
        workspace_id,
        workspace_label,
        tab_id,
        pane_id,
        session_path,
        terminal_title,
        requested_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        status = excluded.status,
        live_status = excluded.live_status,
        workspace_path = excluded.workspace_path,
        prompt_path = excluded.prompt_path,
        workspace_id = excluded.workspace_id,
        workspace_label = excluded.workspace_label,
        tab_id = excluded.tab_id,
        pane_id = excluded.pane_id,
        session_path = excluded.session_path,
        terminal_title = excluded.terminal_title,
        requested_at = excluded.requested_at,
        updated_at = excluded.updated_at
    `),
    deleteBuild: db.prepare(`DELETE FROM builds WHERE fingerprint = ?`),
    insertEvent: db.prepare(`
      INSERT INTO suggestion_events (
        fingerprint,
        event_type,
        at,
        source_session_path,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?)
    `),
    pruneResolved: db.prepare(`
      DELETE FROM suggestions
      WHERE status IN ('dismissed', 'worked')
        AND resolved_at IS NOT NULL
        AND resolved_at < ?
    `),
    insertWorkflowEvidence: db.prepare(`
      INSERT OR IGNORE INTO workflow_evidence (
        event_id, schema_version, project_path, session_anchor, task_id,
        workflow_revision, recorded_at, event_type, evidence_refs_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectWorkflowEvidence: db.prepare(`
      SELECT event_id, schema_version, project_path, session_anchor, task_id,
             workflow_revision, recorded_at, event_type, evidence_refs_json
      FROM workflow_evidence
      ORDER BY recorded_at, event_id
    `),
  };

  function insertEvent(fingerprint, eventType, sourceSessionPath, payload) {
    statements.insertEvent.run(
      fingerprint,
      eventType,
      nowIso(),
      sourceSessionPath ?? null,
      payload ? JSON.stringify(payload) : null,
    );
  }

  function getEnabled() {
    const row = statements.getSetting.get("enabled");
    if (!row) {
      return config.enabled !== false;
    }
    return Boolean(parseJson(row.value_json, config.enabled !== false));
  }

  function setEnabled(enabled) {
    statements.upsertSetting.run("enabled", JSON.stringify(Boolean(enabled)), nowIso());
  }

  function getCheckpoint(sessionKey) {
    if (!sessionKey) {
      return undefined;
    }
    const row = statements.getCheckpoint.get(sessionKey);
    if (!row) {
      return undefined;
    }
    return {
      sessionKey: row.session_key,
      sessionPath: row.session_path ?? undefined,
      cursorMessageId: row.last_cursor_message_id ?? undefined,
      reviewedAt: row.reviewed_at,
      reason: row.reason,
    };
  }

  function saveCheckpoint({ sessionKey, sessionPath, lastCursorMessageId, reviewedAt, reason }) {
    if (!sessionKey) {
      return;
    }
    const timestamp = reviewedAt ?? nowIso();
    statements.upsertCheckpoint.run(
      sessionKey,
      sessionPath ?? null,
      lastCursorMessageId ?? null,
      timestamp,
      reason ?? "clean",
      timestamp,
    );
  }

  // Keep historical IDs and build records intact, but expose one pending item
  // per recommendation, including rows written by the old evidence-based IDs.
  function matchingRows(suggestion) {
    const identity = suggestionIdentity(suggestion);
    return statements.selectAllFingerprints.all()
      .filter((row) => suggestionIdentity(normalizeSuggestionRow(row)) === identity);
  }

  function loadState({ sessionKey } = {}) {
    const visible = statements.selectVisibleSuggestions.all().map(normalizeSuggestionRow);
    const buildsByFingerprint = new Map(
      statements.selectBuilds.all().map((row) => [row.fingerprint, normalizeBuildRow(row)]),
    );
    const allFingerprints = statements.selectAllFingerprints.all();
    const suppressedRows = allFingerprints.filter((row) => SUPPRESSED_STATUSES.has(row.status));
    const suppressedIdentities = new Set(suppressedRows.map((row) => suggestionIdentity(normalizeSuggestionRow(row))));
    const suppressedFingerprints = new Set([
      ...suppressedRows.map((row) => row.fingerprint), ...suppressedIdentities,
    ]);
    const grouped = new Map();
    for (const suggestion of visible) {
      const identity = suggestionIdentity(suggestion);
      if (suppressedIdentities.has(identity)) continue;
      const current = grouped.get(identity);
      // Prefer an existing build so the build key still focuses that work.
      if (!current || (!buildsByFingerprint.has(current.fingerprint) && buildsByFingerprint.has(suggestion.fingerprint))) {
        grouped.set(identity, suggestion);
      }
    }
    const suggestions = [...grouped.values()];

    return {
      enabled: getEnabled(),
      suggestions,
      seenFingerprints: new Set(allFingerprints.flatMap((row) => [row.fingerprint, suggestionIdentity(normalizeSuggestionRow(row))])),
      suppressedFingerprints,
      dismissedFingerprints: suppressedFingerprints,
      buildsByFingerprint,
      lastCheckpoint: getCheckpoint(sessionKey),
    };
  }

  function upsertSuggestions({ suggestions, projectPath, sourceSessionPath }) {
    return withTransaction(db, () => {
      const inserted = [];
      const updated = [];
      const suppressed = [];
      const seenAt = nowIso();

      for (const suggestion of suggestions ?? []) {
        if (!suggestion?.fingerprint) {
          continue;
        }

        const matches = matchingRows({ ...suggestion, projectPath });
        const existing = matches.find((row) => SUPPRESSED_STATUSES.has(row.status))
          ?? matches.find((row) => row.status === "in_progress")
          ?? matches[0]
          ?? statements.selectSuggestion.get(suggestion.fingerprint);
        const featureRefsJson = JSON.stringify(suggestion.featureRefs ?? []);
        const evidenceJson = JSON.stringify(suggestion.evidence ?? []);

        if (!existing) {
          statements.insertSuggestion.run(
            suggestion.fingerprint,
            projectPath,
            suggestion.ruleId,
            suggestion.title,
            suggestion.summary,
            suggestion.recommendation,
            suggestion.payoff ?? null,
            suggestion.tradeoff ?? null,
            featureRefsJson,
            evidenceJson,
            "active",
            suggestion.createdAt ?? seenAt,
            seenAt,
            sourceSessionPath ?? null,
            1,
          );
          insertEvent(suggestion.fingerprint, "observed", sourceSessionPath, { projectPath });
          inserted.push(suggestion.fingerprint);
          continue;
        }

        const updateArgs = [
          projectPath,
          suggestion.ruleId,
          suggestion.title,
          suggestion.summary,
          suggestion.recommendation,
          suggestion.payoff ?? null,
          suggestion.tradeoff ?? null,
          featureRefsJson,
          evidenceJson,
          seenAt,
          sourceSessionPath ?? null,
          existing.fingerprint,
        ];

        if (SUPPRESSED_STATUSES.has(existing.status)) {
          statements.updateSuggestionSuppressed.run(...updateArgs);
          suppressed.push(existing.fingerprint);
          continue;
        }

        statements.updateSuggestionActive.run(...updateArgs);
        insertEvent(existing.fingerprint, "updated", sourceSessionPath, { projectPath, status: existing.status });
        updated.push(existing.fingerprint);
      }

      return { inserted, updated, suppressed };
    });
  }

  function markDismissed(fingerprint, note) {
    return withTransaction(db, () => {
      const existing = statements.selectSuggestion.get(fingerprint);
      if (!existing) {
        return false;
      }
      const resolvedAt = nowIso();
      for (const row of matchingRows(normalizeSuggestionRow(existing))) {
        statements.resolveSuggestion.run("dismissed", resolvedAt, note ?? null, resolvedAt, row.fingerprint);
        statements.deleteBuild.run(row.fingerprint);
      }
      insertEvent(fingerprint, "dismissed", existing.last_source_session_path, note ? { note } : undefined);
      return true;
    });
  }

  function markWorked(fingerprint, note) {
    return withTransaction(db, () => {
      const existing = statements.selectSuggestion.get(fingerprint);
      if (!existing) {
        return false;
      }
      const resolvedAt = nowIso();
      for (const row of matchingRows(normalizeSuggestionRow(existing))) {
        statements.resolveSuggestion.run("worked", resolvedAt, note ?? null, resolvedAt, row.fingerprint);
        statements.deleteBuild.run(row.fingerprint);
      }
      insertEvent(fingerprint, "worked", existing.last_source_session_path, note ? { note } : undefined);
      return true;
    });
  }

  function markInProgress(fingerprint) {
    const changed = statements.markInProgress.run(nowIso(), fingerprint);
    return Number(changed.changes ?? 0) > 0;
  }

  function saveBuild(build) {
    if (!build?.fingerprint) {
      return;
    }

    const existing = statements.selectBuild.get(build.fingerprint);
    const timestamp = nowIso();
    const normalizedBuild = {
      status: build.status ?? existing?.status ?? "launched",
      liveStatus: build.liveStatus ?? existing?.live_status ?? null,
      workspacePath: build.workspacePath ?? existing?.workspace_path ?? null,
      promptPath: build.promptPath ?? existing?.prompt_path ?? null,
      workspaceId: build.workspaceId ?? existing?.workspace_id ?? null,
      workspaceLabel: build.workspaceLabel ?? existing?.workspace_label ?? null,
      tabId: build.tabId ?? existing?.tab_id ?? null,
      paneId: build.paneId ?? existing?.pane_id ?? null,
      sessionPath: build.sessionPath ?? existing?.session_path ?? null,
      terminalTitle: build.terminalTitle ?? existing?.terminal_title ?? null,
      requestedAt: build.requestedAt ?? existing?.requested_at ?? timestamp,
      updatedAt: timestamp,
    };

    statements.upsertBuild.run(
      build.fingerprint,
      normalizedBuild.status,
      normalizedBuild.liveStatus,
      normalizedBuild.workspacePath,
      normalizedBuild.promptPath,
      normalizedBuild.workspaceId,
      normalizedBuild.workspaceLabel,
      normalizedBuild.tabId,
      normalizedBuild.paneId,
      normalizedBuild.sessionPath,
      normalizedBuild.terminalTitle,
      normalizedBuild.requestedAt,
      normalizedBuild.updatedAt,
    );

    insertEvent(build.fingerprint, existing ? "build_updated" : "build_started", build.sessionPath, {
      status: normalizedBuild.status,
      liveStatus: normalizedBuild.liveStatus,
      tabId: normalizedBuild.tabId,
      paneId: normalizedBuild.paneId,
    });
  }

  function recordWorkflowEvidence(record) {
    const evidence = normalizeWorkflowEvidence(record);
    const result = statements.insertWorkflowEvidence.run(
      evidence.eventId,
      evidence.schemaVersion,
      evidence.projectPath,
      evidence.sessionAnchor,
      evidence.taskId,
      evidence.workflowRevision,
      evidence.timestamp,
      evidence.eventType,
      JSON.stringify(evidence.evidenceRefs),
    );
    return Number(result.changes ?? 0) > 0;
  }

  function listWorkflowEvidence() {
    return statements.selectWorkflowEvidence.all().map((row) => ({
      eventId: row.event_id,
      schemaVersion: row.schema_version,
      projectPath: row.project_path,
      sessionAnchor: row.session_anchor,
      taskId: row.task_id,
      workflowRevision: row.workflow_revision,
      timestamp: row.recorded_at,
      eventType: row.event_type,
      evidenceRefs: parseJson(row.evidence_refs_json, []),
    }));
  }

  function pruneResolved() {
    const cutoff = new Date(Date.now() - resolvedRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    return statements.pruneResolved.run(cutoff);
  }

  return {
    storePath,
    resolvedRetentionDays,
    close() {
      db.close();
    },
    getEnabled,
    setEnabled,
    getCheckpoint,
    saveCheckpoint,
    loadState,
    upsertSuggestions,
    markDismissed,
    markWorked,
    markInProgress,
    saveBuild,
    recordWorkflowEvidence,
    listWorkflowEvidence,
    pruneResolved,
  };
}
