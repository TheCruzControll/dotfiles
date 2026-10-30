# Pane placement ownership repair

## Evidence (mock-only)

The supplied screenshot has approximate terminal width proportions 1/8, 1/8,
1/4, 1/2. Those proportions are evidence of repeated horizontal subdivision,
not evidence by themselves of which CLI version or target was used.

`paneStart` already stacks down correctly within one client. Its `children` map
and launch queue were local to `createHerdrClient`, however. Recreating a client
forgot every owned pane and issued another right split of the parent. Three
mock launches through three clients reduced parent width from 160 to 20 rather
than preserving 80 after the first split. This regression failed before the fix.
The control now explicitly loses transport identity and still reproduces widths
20, 20, 40, 80. The exact chronological ordering of screenshot panes is not
proven by this leaf-split mock. No live panes were queried or mutated.

## Change

Clients with the same exec function and resolved binary share owned IDs and one
launch queue. Ownership contains only successfully opened panes; layout discovery
prunes IDs that disappeared or moved outside the parent's right-hand region.
Only those IDs can be selected, never an arbitrary existing pane to the right.
Explicit down placement and missing target bypass stacking; --no-focus is kept.
Layout errors remain fail-closed rather than silently shrinking the parent.

An optional `placementState: PanePlacementState` constructor option lets the
owner restore *explicit* ownership across module reload or transport recreation.
It is JSON-serializable data (`{ children: { [parentPaneId]: paneIds } }`), separate
from the runtime promise queue. Concurrent clients sharing that exact state object
are serialized, even when they use different exec wrappers.

## Parent integration boundary (not modified here)

Plain client recreation now works without an index change when it uses the same
transport. Actual extension/module reload loses module globals. To preserve
placement across that boundary, the parent must retain or persist the state in
its trusted session record and pass it when constructing the next client:

```ts
const placementState = restoredPlacementState ?? { children: {} };
const client = createHerdrClient({ placementState });
// Checkpoint placementState after awaited paneStart calls settle.
```

Restore only the matching Herdr server/session's record, never infer ownership
from titles, adjacency, or a global pane list. A new state object is appropriate
when changing servers. Drain outstanding launches before replacing/reloading the
owner: JSON snapshots cannot serialize in-flight promises, and separate module
instances/processes do not share a queue. Custom exec wrappers recreated on each
client must also pass the same explicit state object. State is trusted internal
metadata, not an unvalidated external input API. Persistence policy remains with
the parent; this repair introduces no filesystem writes or session reloads.

## Verification

`node --test test/herdr-client.test.ts`: 22 passing after repair. Coverage includes
parallel same-client launches, concurrent recreated clients, geometry control,
serialized-state restoration, unrelated-pane rejection, stale/moved IDs,
layout errors, failed-open queue recovery, explicit down/no target, and no-focus.
The broad `node --test test/*.test.ts` gate was attempted but blocked by missing
installed dependencies and sandbox EPERM on the host temporary directory.
No live integration test, install, commit, push, or session mutation was run.
