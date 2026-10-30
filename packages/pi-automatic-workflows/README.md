# Conductor

Conductor (`pi-conductor`) selects task-specific engineering workflows, records compact evidence and resumes bounded, already-authorized external checks while Pi is open. Existing tool, storage, event and resource-path identifiers remain compatible.

## Architecture

The implementation uses a modular, tool-driven controller. `lib/registry.ts` owns the trusted route-to-resource table. `lib/policy.ts` owns validated task state, workflow intent, evidence updates, reminder policy, and delegation accounting. `extension/index.js` is a thin Pi adapter for prompt preparation, tools, commands, lifecycle hooks, and observer events. The observer remains a separate extension and keeps its existing SQLite store.

This design combines the two reviewed architecture candidates. It keeps a single clear controller/ledger while separating pure domain policy from Pi event adapters. Pi's event bus is transient; session entries are the branch-aware task ledger. The observer's database persists its own evidence records. Workflow resources are Markdown, not executable policy.

## Use

The dotfiles installation loads this package through `~/.pi/agent/settings.json`. The installer backs up any legacy absolute-path `extensions/automatic-workflows.js` shim to avoid loading the controller twice. The observer remains separately registered.

Runtime helper imports use `.ts` so Pi/Jiti reloads changed helpers instead of retaining native `.js` module exports. The `.js` helper paths remain compatibility re-exports. Plain Node tests and compatibility imports require Node >=22.18; this installation uses Node 24.15.0. Reload the workflow and observer extensions together after updating. Real Jiti alias-loader tests cover newly added exports and helper-only edits; Pi itself is not patched.

For a one-off invocation:

```sh
pi --extension ./extension/index.js
```

Commands:

- `/workflow status` shows the active route, stage, and limits.
- `/workflow off` disables routing for this session.
- `/workflow on` re-enables routing.
- `/workflow use <route>` selects a route for the next task.
- `/workflow rollback` atomically returns new tasks to the previous retained revision.
- `/workflow recover-lock` archives a promotion lock only when its recorded local owner is confirmed dead.

`workflow_prepare_child` prepares task-owned clean-Git worktrees or controlled non-Git copies and records their canonical identity. Herdr receives the returned `cwd`. Active writers cannot share that directory; a `worktree:true` assertion is not accepted as proof. Dirty Git sources and symlinks in copies are refused. Workspaces are retained for inspection and integration, never automatically deleted.

`workflow_resource` reloads the current task's pinned workflow or a trusted principle. Returned workflow guidance uses absolute revision-specific principle paths. Candidate-backed pins revalidate the retained receipt, content digest, canonical resource path and behavioral evidence on every load, even after a newer revision activates.

Create `.pi-workflows-off` at a project root to opt that project out of routing. Remove the file to opt back in. Routing opt-out does not disable child safety checks.

Actual child processes now use a Darwin-only write fence for standard bash/write/edit and user_bash. Writes are restricted to canonical cwd, owner-allowlisted `/tmp` (macOS `/private/tmp`), and `/dev/null`; root tools, trusted Pi runtime metadata, Herdr records and observer monitoring are unchanged. Unsupported hosts, failed initialization, changed cwd and shadowed protected tools fail closed. This is not read/network/custom-tool confinement or a whole-Pi sandbox. See [child write fence](docs/child-write-fence.md) for deployment provenance, scope and tests; current guarded live acceptance remains pending.

A substantive engineering request receives a compact routing instruction. The main model selects the route through `workflow_select`; this avoids a separate classifier request but adds a tool round trip and does not guarantee the model selects correctly. `workflow_update` records route stages and verification outcomes. Full workflow instructions are loaded only after a trusted route ID is chosen.

## Bounded external waits

Use `/conductor` (the existing `/workflow` alias is retained). `/conductor jobs` lists controller-owned jobs; `/conductor cancel <id>` cancels a local check, not external work.

`workflow_wait` accepts `schedule`, `list`, `cancel`, `outcome`, and `approve`. Scheduling requires `check`, an existing `authorization`, latest `responseRef`, epoch-millisecond `nextDue` and `deadline`, and `maxAttempts` (1–20). At most 20 jobs per task and seven days per deadline. Never use it to acquire new authority or retry an ambiguous mutation. Record outcomes as `working`, `pending-review`, `approval-needed`, `accepted`, or `changes-requested`, with a response reference. A pending outcome may supply the next check time; without one it suspends. Submission is **not** acceptance: completion/cleanup stage updates require accepted evidence and no outstanding jobs.

Approval-needed stops all checks. `approve` requires interactive owner confirmation, returns to working, and cancels old approval waits; schedule a fresh authorized check if needed. This does not approve new external actions, spending, or deployment. Noninteractive sessions stop for owner reconciliation.

The existing branch ledger persists before timers/delivery. Timers never execute external actions: they send custom follow-up messages with the pinned route, scope, constraints and revision. Busy work stays queued locally without interruption; new user input conservatively suspends queued waits to avoid delivering into unrelated work. Cancel and reschedule explicitly after reconciliation. Session/branch mismatches suspend; restart restores eligible scheduled checks, but checks whose delivery already started suspend because their outcome is ambiguous. No daemon, closed-Pi execution, dependencies, or separate durable store is added.

Delivery is at-most-local, not exactly-once external execution. Crash between persistence and delivery may lose a wakeup; reconcile rather than replay mutations. Approval, cancellation, stale/duplicate messages and revision failures fail closed. Live Pi delivery remains a separate release pilot; simulated tests are not that pilot.

## Observer

The controller emits validated, compact `workflow:evidence` events. The existing observer stores normalized metadata in its additive evidence table and keeps its configured settled-run cadence. It does not execute suggestions or start new agent turns. Build actions explicitly choose a recorded-source-project target or a global workflow-resource target; incidental prose does not decide global scope. Global resource builds prepare a separate Markdown resource candidate under `~/.pi/agent/workflow-revisions`. Source evidence remains associated with its canonical recorded project. Candidate receipts retain baseline text, changed paths, a review diff, check results, and content hashes. Resource checks reject missing resources, symlinks, no-op changes, and missing stop/read-only language; the trusted resource regression tests run against the candidate. Promotion uses a filesystem lock, checks for stale base revisions, and rejects edits after verification. New task selections read the active pointer; an existing task retains its selected revision, resource locator, and previously loaded instructions. Candidate evaluation requires an explicit `workflow_candidate_complete` call and final `agent_settled` with no active owned children. Failed/inactive candidates can be explicitly completed again for revalidation; settlement alone does not consume evaluation.

Automatic promotion is still release-gated OFF by default (`PI_AUTOMATIC_WORKFLOWS_ENABLE_PROMOTION` is unset). Activation, active revision loading and rollback now also require a digest-bound behavioral acceptance artifact: complete scenario evidence, independent review, paired off/on measurements on diverse projects, and explicit baseline-derived quality/overhead targets. Structural checks and the environment flag alone cannot authorize activation. The top-level coordinator uses `workflow_candidate_context` and `workflow_candidate_acceptance`, followed by explicit completion and final settlement. The small Node/Python pilot is assessed under the owner's shared-temp permission, but the semantic checklist still has incomplete/fixture-only subcases. Synthetic test reports are not release acceptance. See [readiness closeout](docs/readiness.md) and [release gates](docs/release-gates.md). These checks are not a sandbox against a child process running with the same filesystem permissions. The runtime exposes a candidate event protocol, not an authentication boundary.

## Delegation boundaries

The controller records four-active/eight-total default limits per task. `workflow_request_budget` can ask the interactive owner to authorize exactly the next N launches. Approval is persisted with the task, survives phase changes and reload, and never starts an agent. Denial, missing UI, child requests, stale confirmations and malformed allowances cannot raise the limit. Four-active/no-nesting restrictions do not change. Route changes retain task ownership/counts until explicitly completed and refuse to replace a task with active children. Child launches explicitly inherit the parent's model; unmapped overrides are refused. Current Herdr named acknowledgements stay active until matching runtime/session-owned completion; display names or unknown exits cannot release reservations.

Every controlled launch now requires the updated Herdr provider's capability handshake and pre-artifact admission bridge. Older or shadowed providers fail closed. Direct launches bind their existing reservation without double-counting; internal parallel/chain stages reserve each actual launch. Group preflight checks total budget, active capacity, models and writer directories. Later stages recheck limits and their originating task identity. Resume requires an owned terminal session, matching saved cwd/model and a new counted slot; active or unresolved sessions cannot resume. Reload both extensions together before using these paths.

Herdr persists recovery descriptors and reattaches individual watchers only for matching parent sessions and Unix socket identities. Changed servers, legacy descriptors and ambiguous ownership remain unresolved. Composite progression is not automatically restarted after reload. `workflow_prepare_child` accepts an optional relative `sourcePath` for an exact canonical subdirectory inside the selected project, avoiding a whole-workspace copy for scoped work. Escapes, absolute arguments and symlink aliases are refused. Isolation preparation/validation, resume/composite admission and recovery have fixture/adapter coverage plus bounded live lifecycle evidence: four concurrent reservations, fifth-launch denial, direct/group/resumed cancellation, reload recovery and positive identity-bound terminal release. This is not universal crash/race certification. The text role heuristic is conservative and tested against scoped-negative and mixed-batch instructions, but is not a sandbox against actual child tool use. The original representative pilot failed under its workspace-only policy on a temporary test-log write; that historical verdict is preserved. Guarded calibration, an affected paired rerun and the owner's later `/tmp` allowlist are documented separately in the readiness closeout. Remaining promotion-evidence gaps are explicit rather than assumed passed.

Delivery operations remain separate from routing. A workflow route does not itself authorize commits, pushes, PR creation, merges, deployment, deletion, or external communication.

## Validate

```sh
npm test
npm run check
```

The package tests policy invariants and resource coverage. A successful unit test suite is not an end-to-end proof that model routing, child spawning, observer promotion, or global installation works.

## Source and license

The full upstream pstack source is retained unmodified under `vendor/pstack/skills` for reference and attribution. The Pi adaptations are under `workflows/` and `principles/`. See `CONTENT-README.md` and `vendor/pstack/LICENSE`. Upstream revision: `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`.
