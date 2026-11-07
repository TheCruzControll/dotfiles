---
name: setup-orchestrator
description: Configure which models the orchestrator uses per role and at what reasoning budget. Detects your available models and writes ~/.pi/agent/orchestrator-models.md, which overrides the skill defaults. Use for /skill:setup-orchestrator, "configure orchestrator models", "orchestrator budget", or changing the orchestrator's model choices.
---

# Setup orchestrator

Write `~/.pi/agent/orchestrator-models.md`, the file that sets the orchestrator's model per role. The orchestrator extension injects it into every system prompt, so no AGENTS.md entry is needed.

## Steps

### 1. Detect available models

Run `pi --list-models`. Its columns are provider, model, context, max-out, thinking (yes/no), and images. Each row is a real value `provider/model`, written as `provider/model:thinking` when its thinking column is `yes`. That is the dependable source. If the command fails, ask the user to paste the models they have access to. Never write a real model you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected models.

### 2. Load current state

The default role-to-model mapping is the file shape shown in step 5 below. If `~/.pi/agent/orchestrator-models.md` already exists, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer ask_user_question over free text. Offer these four options with these exact labels, and name the current budget when the file records one. With no file, say that `large` matches the skill defaults.

- `unlimited — max reasoning`
- `large — default reasoning per role`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Build the working table from the skill defaults, and on a re-run keep any role you changed by model, list, or alias (`inherit-parent`, `auto`). `unlimited`, `medium`, and `small` set the `:thinking` level of every real value, panel entries included, to `max`, `high`, or `medium`. `large` keeps the defaults as listed (`high`, `medium`, or `xhigh` per role) and leaves the level of a role you changed as it is. Levels sit on the ladder `max` > `xhigh` > `high` > `medium` > `low`. A model whose thinking column is `no` gets no `:thinking` suffix. `inherit-parent` and `auto` do not change. So `unlimited` turns `anthropic/claude-opus-5-5:xhigh` into `anthropic/claude-opus-5-5:max` and `openai/gpt-6.1-terra:high` into `openai/gpt-6.1-terra:max`. `small` turns them into `anthropic/claude-opus-5-5:medium` and `openai/gpt-6.1-terra:medium`.

**(c) Show the roles and confirm.** Show every role with its model, marking any real model not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` (both mean: this role runs on the parent model) as the options. Prefer ask_user_question over free text; it takes at most 4 options per question, and the user can type any other detected model. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena runs one judge. It tries only values from a family other than the parent's, in list order, so order it by preference. An `inherit-parent` or `auto` value never judges. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm. `escalation` runs only after a `hardest tasks` delegate fails the same check as two cheaper ones, so pick the strongest model available.

### 4. Validate

Every real model written must be in the detected set. `inherit-parent` and `auto` always pass. If a chosen real model is not available, stop and ask again.

### 5. Write the file

Write `~/.pi/agent/orchestrator-models.md` with no frontmatter: `#` comment lines, a `# budget: <label> (<level>)` line with the chosen label and its target level (`default` for `large`), and one `role: value` line per role, using the same labels orchestrator uses. Overwrite the whole file so re-runs stay idempotent. Shape:

```
# Orchestrator model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent model (omit Agent `model` and `thinking`). Alias entries in a panel list still count toward its fan-out.
# budget: large (default)
feature, refactoring: openai/gpt-6.1-terra:high
bug-fix: openai/gpt-6.1-terra:high
perf-issue: openai/gpt-6.1-terra:high
hillclimb: openai/gpt-6.1-terra:high
judgment and prose: anthropic/claude-opus-5-5:xhigh
hardest tasks: anthropic/claude-opus-5-5:xhigh
how explorer: openai/gpt-6.1-terra:medium
how explainer: anthropic/claude-opus-5-5:xhigh
why investigators: openai/gpt-6.1-terra:medium
why synthesizer: anthropic/claude-opus-5-5:xhigh
reflect tooling: openai/gpt-6.1-terra:medium
reflect judgment, divergent, synthesizer: anthropic/claude-opus-5-5:xhigh
arena runners: anthropic/claude-opus-5-5:xhigh, openai/gpt-6.1-sol:high
arena cross-judge pool: anthropic/claude-opus-5-5:xhigh, openai/gpt-6.1-sol:high
swarm workers: openai/gpt-6.1-terra:high
architect runners: anthropic/claude-opus-5-5:xhigh, openai/gpt-6.1-sol:high
interrogate reviewers: anthropic/claude-opus-5-5:xhigh, openai/gpt-6.1-sol:high
escalation: anthropic/claude-fable-5-1:high
```

### 6. Confirm

Tell the user the file was written and that it applies from the next turn. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /skill:create-verification-skill." On yes, read [create-verification-skill](../create-verification-skill/SKILL.md) and follow it. On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /skill:create-formal-verification-skill." On yes, read [create-formal-verification-skill](../create-formal-verification-skill/SKILL.md) and follow it. On no, move on without pushing.
