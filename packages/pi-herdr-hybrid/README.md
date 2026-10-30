# Pi Herdr Hybrid

Interactive Pi child TUIs from [modem-dev/pi-herdr-subagents](https://github.com/modem-dev/pi-herdr-subagents), plus named agent profiles, parallel/chain workflows, and bounded parent-supervised councils adapted from pi-subagents.

## Requirements / installation

Pi 1.4, Node 22+, Herdr >= 0.8.2. Run Pi inside a Herdr pane. One package must own the subagent tool surface; remove other subagent extensions from active package configuration.

```
# From this package directory:
herdr plugin link "$PWD/herdr-plugin" --enabled
pi install "$PWD"
```

Then start a fresh Pi session. `/subagents-init` copies missing bundled profiles into the user agent directory without overwriting existing files. `/subagents-init project` installs project-local profiles. Project profiles override global profiles.

The Herdr plugin retains upstream's `pi-herdr-subagents` identity and static dispatcher contract; the Pi package is named `pi-herdr-hybrid`.

## Tools

- `subagent({name, task, agent?, fork?, model?, cwd?, interactive?})`: launch a real interactive Pi TUI asynchronously.
- `subagent_resume({sessionPath, message?, name?, autoExit?})`: resume a retained session in a new pane.
- `subagent_interrupt({id?, name?})`: interrupt a child's current turn, not kill its pane.
- `subagents_list`: discover named profiles.
- `subagent_workflow({action:"start", mode:"parallel"|"chain", steps:[{key,agent?,task,context?,cwd?,model?}]})`: launch a keyed parallel group or sequential chain. At most 16 steps. `context` is `fresh` or `fork`; omit it to use profile defaults.
- `subagent_workflow({action:"list"|"status"|"cancel", id?})`: inspect or cancel progression. Cancellation requests interruption of running turns, but does not kill panes or prove children stopped. Workflow `interrupts` retains every `{id, late, receipt}` record, including late launches and failures; current-session updates report those receipts. Inspect workflow status for pending or failed requests; repeated cancellation returns the retained history without retrying. Workflows are parent-only, not recursively exposed to children.

New and resumed children open to the parent's right; additional children split the tallest owned child downward instead of repeatedly shrinking the parent. Placement is serialized for parallel launches and preserves focus. Only panes opened by the current client are tracked: reloading Pi does not adopt or rearrange existing panes. Many children will still reduce vertical space.

Results arrive as async steer messages. Chains pass prior explicit summaries/session paths to the next step as data. Only explicit `completed` outcomes advance. A ping, unreported user exit, crash, or launch failure blocks the workflow. Parent/user requests recovery explicitly using resume or a new workflow; there is no automatic retry or configurable branching engine.

Workflow state is session-local. Audit snapshots are persisted as `hybrid-workflow` session entries; reload/session shutdown cancels progression, never silently relaunches children. Existing child sessions remain recoverable with resume. Normal upstream lifecycle governs panes: clean exits close, startup crashes remain visible. No custom takeover pause or acceptance gate is added.

## Agent profiles

Global `~/.pi/agent/agents/*.md`, with project `.pi/agents/*.md` overrides. Supports upstream fields including model, tools, thinking, spawning, auto-exit, interactive, session-mode, skills, and system-prompt. Hybrid also accepts pi-subagents `systemPromptMode`, `defaultContext: fork`, and `inheritSkills: false`. Other legacy policy fields are not claimed as enforcement. Read-only tools must be explicitly restricted in a profile. Only Pi children are supported.

## Workflows / councils

`/parallel-research`, `/implement-review`, and `/council` are parent prompts. Council instructions preserve independent reports, curated cross-exam, optional explicitly requested third pass, and parent-written memo. Reports use JSON task instructions rather than a structured-output tool API. No arbitrary workflow scripting, external runner support, or drop-in pi-subagents API compatibility is promised.

## Development / verification

`npm test` runs lifecycle, launch, tool, and workflow unit tests. `PI_TEST_MODEL=openai/gpt-5.4-mini npm run test:integration` uses isolated Herdr sessions and real Pi children; requires tmux and existing model auth. Integration tests never manipulate unrelated panes. Optional direnv/devenv tests require their own setup and report skips when unavailable.

Local development resolves host peer dependencies via local node_modules symlinks. On another machine install the matching Pi peer dependencies before testing. Pi supplies them when loading the extension.

## Provenance / license

Foundation: modem-dev/pi-herdr-subagents commit 2489019ea678f0b7e3437727a0a5ca15d4cbe9c1 (MIT), including modules ported from HazAT/pi-interactive-subagents. Original attribution is retained in source. Agent and council material adapted from installed pi-subagents-herdr 0.83.1; see LICENSE.pi-subagents. Upstream README and provenance are retained in git history.

## Resume policy and sidebar reporting

New children save a curated, owner-readable (`0600`) `<session>.launch-policy.json` sidecar, not an environment dump. Resume reapplies tools, skill inheritance, role prompt, deny/spawning restrictions, agent directory, cwd, and explicit model/thinking. Keep this trusted sidecar with the session; role text can contain sensitive instructions. Validation checks structure and consistency, not authentication: a valid owner edit can change the policy. It is not a sandbox. Version 2 policies require every field explicitly; `null` records intentionally absent settings (including default tool selection or no deny list), and role text/mode must be a consistent pair. Missing fields, empty restrictions, inconsistent values, and legacy/incomplete policies are refused, never silently resumed unrestricted: launch a fresh explicitly profiled child with curated prior results instead.

Child TUIs keep the installed Herdr reporter's TUI gate and pane-local environment. Normal agent-directory discovery is unchanged. When selecting a different child agent directory, hybrid uses its installed `extensions/herdr-agent-state.ts`, or explicitly loads the original directory's conventional reporter. For reporters installed elsewhere, set `PI_HERDR_REPORTER_EXTENSION` to its absolute path. A missing reporter during an agent-directory override fails planning with setup guidance rather than silently dropping sidebar reporting. Do not configure a second reporter implementation or remove the TUI gate. Resume retains any explicit reporter path. No global settings are changed.
