# pi-durable-handoff

A performance-first Pi package for short sessions, durable handoffs, and batched progress checkpoints.

## What it does

The package includes two local workflow helpers:

### Durable handoff

When the current session reaches roughly 70% context usage, the extension:

1. stops the main agent at the end of the current turn/tool batch and waits until it is idle
2. generates a lean durable handoff outside the project directory while the main agent remains stopped
3. starts a fresh Pi session and sends a kickoff prompt pointing at the generated handoff

The handoff flow is designed to keep startup context small:

- `handoff.md` is the only file meant to be read automatically
- `decisions.md` and `failures.md` are reference files for on-demand lookup
- `tasks.md` is created only when it adds value
- existing specs, plans, ADRs, issues, commits, and diffs are referenced by known path or URL rather than duplicated
- an operator note tailors the next-session objective and next step without dropping acceptance conditions, non-goals, or blockers
- `Suggested skills` lists only conversation-evidenced skills, with a short why and path when known (or None); kickoff considers only those relevant to the immediate next step, verifies availability, and reads `SKILL.md` through Pi's read tool without overriding workflow constraints
- no default `CLAUDE.md` is generated, to avoid duplication
- persisted `rpiv-todo` state is copied into the new session before startup replay, preserving IDs, statuses, dependencies, metadata, cleared lists, and the next task ID
- immediately before replacement, synchronously requests `workflow:continuation-export` from the workflow owner and appends its exact JSON snapshot as `workflow:continuation-transfer` during destination setup; the core alone validates ownership and atomically imports it
- malformed or conflicting replies, or a missing reply when the branch contains unfinished workflow state, block replacement (the host event bus can swallow owner errors); no owner and no task still permits ordinary handoff
- cancelled replacement does not consume the workflow export; retry requests a fresh snapshot, never one selected from history or generated prose
- kickoff uses the transferred list instead of recreating tasks; the source session retains its history, and ordinary `/new` sessions still start empty
- automatic and manual handoffs defer before generation while the active branch has owned children that are active or unresolved; terminal lifecycle evidence makes automatic handoff eligible again
- if a child starts during generation, its result is discarded before file writing; ownership is checked again before session replacement. No ownership transfer or force option is provided

## Output location

Handoffs remain outside the project directory, under `~/.pi/agent/tmp`:

`~/.pi/agent/tmp/handoffs/<project-hash>/<session-id>-<timestamp>/`

Typical files:

- `handoff.md`
- `decisions.md`
- `failures.md`
- `tasks.md` (optional)
- `session.json`

## Included resources

- `extensions/durable-handoff.ts` — threshold watcher, file generation, and fresh-session launch
- `extensions/checkpoint-observer.ts` — batches progress checkpoints at `agent_settled`, keeps footer status compact, only shows a widget for blockers/decisions, and only interrupts on blockers or real decisions
- `skills/durable-record/` — guidance for reading and maintaining lean durable records

## Install locally

From the project root:

```bash
pi -e ./pi-durable-handoff
```

For handoffs across projects, install it at user scope (without `--local`):

```bash
pi install ./pi-durable-handoff
```

A declaration in `.pi/settings.json` loads only for that project; it will not protect sessions started in a sibling directory. Existing sessions need `/reload` after changing package settings. Confirm availability with `/durable-handoff-status`. User settings can filter `extensions` to `["extensions/durable-handoff.ts"]` to enable handoffs globally without enabling the checkpoint observer globally. Equivalent local package paths are deduplicated by Pi.

## Commands

- `/durable-handoff-now` — interrupt current main-agent work, wait for idle, then generate a durable handoff and continue in a fresh session (owned children still defer handoff)
- `/durable-handoff-now finish the focused regression tests` — use the existing operator note as next-session focus
- `/durable-handoff-status` — show threshold and latest handoff status
- `/observer-status` — show the latest settled progress checkpoint

## Focused verification

With Node 24+ and the Pi dependencies available: `node --test tests/*.test.ts`. Use an isolated `HOME` for generated test handoffs.

For dependency resolution without installs, add `--import ./tests/host-dependencies.mjs` to the test command. Set `PI_WORKFLOW_CORE_DIR` to a repaired automatic-workflows package to enable the actual cross-extension adapter test (no live session/provider or reload).

For local integration, set `PI_CODING_AGENT_DIR` to the installed `@earendil-works/pi-coding-agent` package directory and `RPIV_TODO_DIR` to the installed `@juicesharp/rpiv-todo` directory before running that command. It checks in-memory session transfer against installed todo replay without provider calls or live sessions.

## Notes

- The checkpoint observer batches progress updates at settled checkpoints so long runs do not need extra “continue” nudges just to expose status.
- It watches `todo` tool results when available, keeps the footer status compact, only shows the below-editor widget for blockers or decisions, and only notifies on blockers or decisions that need the user.
- This package is optimized to reduce context bloat, not to maintain a verbose project diary.
- The handoff generator relies on the active Pi model to summarize the current session.
- Handoff slash commands execute immediately even when sent as follow-ups, so the command explicitly stops the main agent and waits for idle before capturing history. Cancelling or failing generation leaves the old agent stopped; resume it explicitly when ready. This does not suspend independent background shell jobs.
- Generation instructions request redaction of API keys, passwords, tokens, and unnecessary PII, including in snippets and URLs. Redaction is model best-effort, not deterministic; it does NOT sanitize the original session/history or the operator note stored in `session.json` metadata.
- The extension uses a queued slash-command handoff flow because Pi session replacement APIs are command-only, not available directly inside lifecycle hooks.
