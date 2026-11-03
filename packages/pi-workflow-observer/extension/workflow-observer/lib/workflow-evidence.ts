import fs from "node:fs";
import path from "node:path";

export const WORKFLOW_EVIDENCE_SCHEMA_VERSION = 1;
export const FRICTION_TYPES = Object.freeze([
  "overdue_check_running", "equivalent_failure", "tool_validation_error",
  "redundant_route", "unresolved_child", "transfer_conflict", "missing_evidence",
]);
const EVENT_TYPES = new Set([
  ...FRICTION_TYPES,
  "route_selected",
  "route_changed",
  "stage",
  "verification",
  "verification_invalidated",
  "correction",
  "settled",
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const ALLOWED_FIELDS = new Set([
  "eventId",
  "schemaVersion",
  "projectPath",
  "sessionAnchor",
  "taskId",
  "workflowRevision",
  "timestamp",
  "eventType",
  "evidenceRefs",
]);

function boundedId(value, field) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new TypeError(`Invalid workflow evidence ${field}`);
  }
  return value;
}

function boundedSessionAnchor(value) {
  if (typeof value !== "string" || value.length > 512 || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError("Invalid workflow evidence session anchor");
  }
  return value;
}

export function canonicalProjectPath(projectPath) {
  if (typeof projectPath !== "string" || !path.isAbsolute(projectPath)) {
    throw new TypeError("Workflow evidence requires an absolute project path");
  }

  let canonicalPath;
  try {
    canonicalPath = fs.realpathSync(projectPath);
  } catch {
    throw new TypeError("Workflow evidence project path does not exist");
  }
  if (!fs.statSync(canonicalPath).isDirectory()) {
    throw new TypeError("Workflow evidence project path is not a directory");
  }
  return canonicalPath;
}

export function normalizeWorkflowEvidence(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Workflow evidence must be an object");
  }
  for (const field of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new TypeError(`Unsupported workflow evidence field: ${field}`);
    }
  }
  if (record.schemaVersion !== WORKFLOW_EVIDENCE_SCHEMA_VERSION) {
    throw new TypeError("Unsupported workflow evidence schema version");
  }
  if (!EVENT_TYPES.has(record.eventType)) {
    throw new TypeError("Unsupported workflow evidence event type");
  }
  if (typeof record.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.timestamp)) {
    throw new TypeError("Invalid workflow evidence timestamp");
  }
  const parsedTimestamp = new Date(record.timestamp);
  if (!Number.isFinite(parsedTimestamp.getTime()) || parsedTimestamp.toISOString() !== record.timestamp) {
    throw new TypeError("Invalid workflow evidence timestamp");
  }
  if (!Array.isArray(record.evidenceRefs) || record.evidenceRefs.length > 16
      || (FRICTION_TYPES.includes(record.eventType) && record.evidenceRefs.length === 0)) {
    throw new TypeError("Workflow evidence refs must be an array of at most 16 IDs; friction requires a source ref");
  }

  return {
    eventId: boundedId(record.eventId, "event ID"),
    schemaVersion: WORKFLOW_EVIDENCE_SCHEMA_VERSION,
    projectPath: canonicalProjectPath(record.projectPath),
    sessionAnchor: boundedSessionAnchor(record.sessionAnchor),
    taskId: boundedId(record.taskId, "task ID"),
    workflowRevision: boundedId(record.workflowRevision, "workflow revision"),
    timestamp: new Date(record.timestamp).toISOString(),
    eventType: record.eventType,
    evidenceRefs: [...new Set(record.evidenceRefs.map((ref) => boundedId(ref, "evidence reference")))],
  };
}

// Counts observed facts, not inferred waste or unknown wall-clock gaps.
export function summarizeFriction(records) {
  const counts = Object.fromEntries(FRICTION_TYPES.map((kind) => [kind, 0]));
  const seen = new Set();
  for (const record of records) {
    if (!FRICTION_TYPES.includes(record.eventType) || seen.has(record.eventId)) continue;
    seen.add(record.eventId);
    counts[record.eventType] += 1;
  }
  return { advisory: true, counts };
}

export function registerWorkflowEvidenceListener(pi, store) {
  pi.events.on("workflow:evidence", (record) => {
    try {
      store.recordWorkflowEvidence(record);
    } catch {
      // Evidence is advisory; invalid data and storage faults must not affect the run.
    }
  });
}
