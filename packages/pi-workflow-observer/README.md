# Workflow Observer Prototype

Local, opt-in Pi extension prototype for checkpoint-triggered workflow suggestions.

## What it does

- reviews the **current Pi session** at `agent_settled` checkpoints
- skips cheaply when there is not enough new activity
- records **suggestion-only** workflow proposals as custom session entries
- shows a compact observer badge in the Pi footer and only shows the widget when reviewing or when suggestions are pending
- supports explicit review of another session **only** when you pass its full path
- can launch a dedicated Herdr-backed build session for a selected suggestion

It does **not**:
- install globally
- auto-enable itself
- change prompts, permissions, tools, or policies
- scan all session archives
- run as a daemon outside Pi

## Files

- `extension/workflow-observer/index.js` — extension entry point
- `extension/workflow-observer/lib/` — pure review logic and state reconstruction
- `extension/workflow-observer/config.json` — local cadence/settings
- `test/` — node tests for the heuristic engine

## Opt-in load

From this repo:

```bash
pi --extension ./extension/workflow-observer/index.js
```

That keeps the prototype local to the current Pi launch.

## Commands

- `/observer status`
- `/observer on`
- `/observer off`
- `/observer run`
- `/observer run /absolute/path/to/session.jsonl`
- `/observer list`
- `/observer open`
- `/observer build <id-prefix>`
- `/observer dismiss <id-prefix>`
- `/observer cancel`

## Config

Edit `extension/workflow-observer/config.json`:

- `enabled`
- `minNewMessages`
- `cooldownMs`
- `maxMessages`
- `maxSuggestionsPerRun`
- `showWidget`

## Validation

```bash
npm test
npm run preview:history
npm run check
```

## Build flow

From `/observer open`, press `b` on a selected suggestion.

The prototype will:
- create `./.observer-workspace/` if it does not already exist
- write a per-suggestion prompt under `./.observer-workspace/requests/`
- create or reuse a dedicated Herdr space labeled `Workflow builds`
- use that space’s first tab when it is newly created, otherwise create a new tab in that space
- start a new Pi session there with the generated prompt
- reflect tracked build state back in the observer panel

If the suggestion already has a live build tab, the build action focuses that tab instead of duplicating it.

## Rollback

Stop loading the extension:

```bash
# just start Pi without the --extension flag
pi
```

Nothing in this prototype writes to global Pi settings or installs a package, so rollback is just “do not load it”.
