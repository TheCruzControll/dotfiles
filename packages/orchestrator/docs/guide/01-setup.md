# Set up orchestrator

In this page you install the package, pick which models orchestrator uses, and run your first task.

## Install the package

Install pi-subagents if it is not already installed, then install orchestrator:

```sh
pi install npm:@tintinweb/pi-subagents@0.23.1
pi install ~/dotfiles/packages/orchestrator
```

## Pick your models

Run:

```text
/skill:setup-orchestrator
```

[`/skill:setup-orchestrator`](../../skills/setup-orchestrator/SKILL.md) detects the models you have access to with `pi --list-models`, asks for a reasoning budget, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes `~/.pi/agent/orchestrator-models.md`, which the orchestrator extension injects into the system prompt.

The `large` budget uses the role defaults for unchanged roles: code delegates use `openai/gpt-6.1-terra:high`, explorers use `openai/gpt-6.1-terra:medium`, judgment uses `anthropic/claude-opus-5-5:xhigh`, and review panels use Opus and `openai/gpt-6.1-sol:high`. For models that support thinking, `unlimited` sets reasoning to `max`; `medium` and `small` set it to `high` and `medium`, respectively.

You only override what you care about. A role with no line in the file keeps the skill's default. To restore a default, delete that role's line. A rerun of `/skill:setup-orchestrator` keeps any role whose model differs from the default. When a default changes, a file written before the change still pins the old default, so delete those role lines, or delete the file, then run `/skill:setup-orchestrator` again.

Set a role to `inherit-parent` or `auto` and orchestrator omits the subagent `model` and `thinking` fields, so the subagent inherits your parent model. Both values mean the same thing, and neither is a model slug. For a panel role the value is a list, and one subagent runs per entry, so the list length sets the panel size. The arena cross-judge pool is an exception: it runs one judge, trying eligible entries in order. Setup also configures `swarm workers`, the default model for every `/skill:swarm` worker unless a race names a model for each arm.

## Accept the verification offers, or don't

At the end of setup, `/skill:setup-orchestrator` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/skill:create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.pi/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/skill:create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

If you're new to orchestrator, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

Then setup offers once to generate a formal verification skill with [`/skill:create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md), unless the project already has one. Tests check the cases someone thought to write. A formal verification skill checks one key property of your code, such as "a job never runs twice at once", in every case within a stated scope. Say yes when your code has concurrency, retries, a state machine, or a parser, where a bug is costly and tests rarely reach the case that breaks. Otherwise say no, and run it later if that changes. [Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) covers it.

The model configuration applies from the next turn.

## Keep the cost in check

Orchestrator spends extra tokens on subagents and review panels. That's the price of the rigor. To spend fewer:

- Rerun `/skill:setup-orchestrator` and pick a smaller reasoning budget or cheaper models. A strong model in the main chat with cheaper models in the code roles is a good split.
- Set a role to `auto` or `inherit-parent` so it runs on the chat's own model.
- Shorten a panel list. Each entry runs one subagent.
- Use `/orchestrator off` for work that doesn't need rigor; `/orchestrator on` restores it.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/skill:orchestrator add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If orchestrator skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. Orchestrator is on by default for the session; use `/orchestrator on`, `/orchestrator off`, or `/orchestrator status` to control or check it.

Next: [Route work through orchestrator](./02-orchestrator.md).
