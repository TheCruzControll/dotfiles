# Structured workflow transport

Durable handoff uses a 70% threshold, todo copy, prose files, and active/unresolved-owned-child gates. After generation, immediately before requesting replacement it emits:

```ts
pi.events.emit('workflow:continuation-export', {
  projectRoot: path.resolve(ctx.cwd),
  respond(snapshot) { /* synchronous only */ }
});
```

Exactly one owner may respond synchronously with serializable JSON:
`{schemaVersion: 1, transferId, sourceSessionId, projectRoot, task}` where task includes `continuationGeneration`. IDs/root must match the source session and resolved project root; generation must be a nonnegative safe integer. The entire snapshot is preserved without normalization or task rewriting, detached from exporter mutations. Malformed or multiple responses block replacement; late responses cannot enter a completed capture.

No response permits ordinary handoff only when the branch has no unfinished workflow state. Otherwise it blocks replacement and requests reconciliation. This matters because Pi's event bus logs and swallows owner callback exceptions. Ledger inspection is only a loss-prevention gate, never a source of permission or a stale snapshot to transfer.

The owner may persist an outgoing ticket during synchronous export. Handoff permits these `automatic-workflows` updates, but blocks other branch changes, aborts, or newly owned children before replacement. Export is non-consuming: cancellation leaves the source usable, and retry requests a fresh export.

Destination `ctx.newSession` setup appends the exact snapshot as `workflow:continuation-transfer` alongside `rpiv-todo-state`. No additional handshake or callback is used. The core validates the exact stored snapshot and pinned revision, then atomically claims task-wide ownership/generation. Repeated import, even to the same destination, must fail closed and never reset consumed launch budgets or breaker counters. Older source branches and ordinary forks cannot acquire ownership. Session-before-switch/shutdown activity must be fenced by core freshness validation at import; transport does not implement ownership arbitration.

Kickoff prose and generated files grant no authorization. Concurrent commands are suppressed, and aborted generation cannot export even if a provider ignores its signal. Post-switch work uses only the replacement context.

## Checks without installation

Use Node 24+ and existing host dependencies from the repository root:

```sh
PI_CODING_AGENT_DIR=/path/to/installed/@earendil-works/pi-coding-agent \
RPIV_TODO_DIR=/path/to/installed/@juicesharp/rpiv-todo \
PI_WORKFLOW_CORE_DIR=/path/to/repaired/pi-automatic-workflows \
HOME="$(mktemp -d)" node --import ./packages/pi-durable-handoff/tests/host-dependencies.mjs \
  --test packages/pi-durable-handoff/tests/*.test.ts
```

Todo replay and actual-core adapter tests explicitly skip when their corresponding paths are absent. The adapter exercises real core export/import with the handoff command and mocked command contexts; it is not a live-session acceptance test. Tests use isolated HOME and temporary revision stores, without installs, configuration edits, provider calls, or reload.
