# Child lifecycle records (version 1)

The extension emits `workflow:child-lifecycle` through Pi's event bus and appends a custom Pi session entry with the same type and payload. Persistence is attempted before event delivery; failures are isolated so lifecycle consumers cannot break normal subagent tools or steer delivery.

Every payload contains `version: 1`, `id`, `name`, `sessionFile`, `status`, and an ISO `timestamp`. `paneId` and `reason` are optional. Consumers should ignore unsupported versions. Multiple records for one child are expected; these are observations, not commands or exactly-once delivery guarantees.

Statuses:
- `started`: pane creation returned successfully (before best-effort rename).
- `interrupt-requested`: Escape was requested, not proof the child stopped.
- `completed`: watcher supplied positive completion or zero-exit evidence, including an explicit user close. This settles ownership, not whether the requested work succeeded.
- `failed`: watcher supplied positive failure/exit evidence.
- `unresolved`: cancellation, unknown exit, ping/interactive handoff, watcher exception, ambiguous pane creation failure, interrupted launch, or shutdown/reload observation loss. Ownership must not be settled merely because observation ended.

Composite progression requires the explicit successful `completed` watcher outcome. A `completed-user-exit` lifecycle record can release the reservation but never advances a chain or certifies the task's result.

Shutdown/reload records unresolved ownership before aborting watcher observation and requests Escape; it does not force-kill children. A persistence failure during teardown cannot guarantee a durable receipt (there is no additional disk journal/retry).

## Identity-bound watcher recovery

Once a launch attaches its watcher, another `started` entry includes an optional versioned `recovery` descriptor: a whitelisted runtime snapshot, parent session file, and Herdr Unix socket identity (device, inode, birth time and change time). It contains no AbortController and is never used to execute saved scripts.

On `session_start`, the active branch is replayed. A child with no terminal record can have its watcher reattached only when parent session, child ID/session/pane identity and the current socket identity all match. No new pane or agent is launched. Resume descriptors retain the transcript cursor. Old-generation watcher outcomes cannot deliver results or persist terminal records into the new session. Observation failures retain native ownership, not just the controller's reservation.

A missing descriptor, legacy entry, missing/replaced socket, different parent, or malformed identity produces an unresolved warning instead of pane attachment. Restarts that preserve the same Herdr server can recover; replacing that server requires explicit reconciliation. Socket identity is a local consistency guard, not authentication against another process running as the same user. Recovery reattaches individual child watchers; it does not restart composite workflow progression.

Launch AbortSignals are launch-scoped: pre-aborted launches never start a pane; abortion while pane creation/rename is pending requests native Escape once the pane identity is known and records unresolved ownership. Successful direct background launches do not retain the tool signal, preserving their fire-and-forget semantics. Composite runs instead retain their original caller context and a per-run AbortController until completion, cancellation or disposal; caller abortion cancels progression, reaches pending native launches, and requests interruption for running or unresolved-owned children. Later chain stages use that same context and signal, not the context of an unrelated status call. Notification failures are retained on the run and cannot suppress interruption. The native orchestrator requests Escape, not a force kill; individual tools retain their own subprocess-cancellation behavior.

Cancelled watcher outcomes still do not send a new user-facing steer; their identity is available through lifecycle records. Existing results now also carry the child id, and watcher-error result details include id/sessionFile/unresolved status.
