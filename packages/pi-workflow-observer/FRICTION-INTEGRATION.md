# Advisory friction event contract

Reuse the existing `workflow:evidence` bus and `workflow_evidence` table; no new
ledger, timer, dashboard, policy or approval path. Producers may send facts while
the agent is running; they do not wait for `agent_settled`. The existing listener
isolates malformed events/storage errors from execution. `summarizeFriction`
returns deduplicated event counts with `advisory: true`, never a waste duration.
Pass `store.listWorkflowEvidence()` filtered to the relevant task/revision/session
when scoped counts are desired. Counts measure observed incidents, not all work.

Existing v1 envelope is unchanged: `{schemaVersion: 1, eventId, projectPath,
sessionAnchor, taskId, workflowRevision, timestamp, eventType, evidenceRefs}`.
Refs are at most 16 opaque IDs of at most 128 restricted characters. No prompt,
arguments, error strings, paths beyond the existing canonical project identity,
URLs, tokens, record bodies or unknown properties are accepted. Owners must use
opaque IDs, never encode sensitive text in IDs. Identity paths remain local in
the existing store; this is data minimization, not anonymization.

New eventType values and owner responsibility:

- `overdue_check_running`: scheduled check owner observes a due authorized check
  still unhandled *while running*. Emit once per check/due generation. An idle
  interval, suspended job, restart gap or unknown activity is not evidence.
- `equivalent_failure`: owner identifies same operation/input revision/failure
  classification repeated without changed preconditions. Emit for each repeat,
  not the first failure. Do not infer equivalence from raw error prose.
- `tool_validation_error`: runtime owner explicitly classifies argument validation
  failure. General `isError` results are insufficient (unknown, blocked and aborted
  tools can also fail); owner must publish the structured classification.
- `redundant_route`: route owner knows same route/task/revision was selected again
  without a relevant transition. A route_changed event alone is insufficient.
- `unresolved_child`: child owner finds outstanding children at its required join
  or completion boundary, not merely children performing useful work.
- `transfer_conflict`: transfer owner reports an actual competing transfer or
  revision conflict, not an inferred lack of progress.
- `missing_evidence`: completion owner finds required scoped proof absent or
  invalid. Tests or a transport response cannot replace acceptance/content proof.

Example, in the existing owner running-check callback:

```js
pi.events.emit('workflow:evidence', {
  schemaVersion: 1, eventId: 'check-42-due-3',
  projectPath, sessionAnchor, taskId, workflowRevision,
  timestamp: new Date().toISOString(),
  eventType: 'overdue_check_running', evidenceRefs: ['wait-record-42'],
});
```

Stable event IDs deduplicate replay in existing storage and summaries. Producers
must coalesce repeated observations of one incident instead of polling emissions.
Owner events are deliberately required: this package cannot safely infer these
facts from generic wall-clock gaps or transcript text. Core/runtime/child/transfer
owners must add the above emissions where their authoritative state is available;
this isolated implementation does not modify those owners or manufacture facts.
The collector is passive, even for missing proof; core owns completion policy.
Existing explicit observer build actions are unchanged; these events never invoke
them, install anything, edit configuration, approve or launch work.
