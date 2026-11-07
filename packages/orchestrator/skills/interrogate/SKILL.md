---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Adversaries try to break a change or design, and only findings proven by a run survive."
disable-model-invocation: true
---

# Interrogate

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not apply fixes.

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree. Read `skills/in-your-own-words/SKILL.md` in the installed package and follow it to state the intent, from the user's message, the commits, and the PR description. Ask the user when the intent is unclear.

## Fan out

Read `skills/arena/SKILL.md` in the installed package and follow Phase A steps 3 and 4 and Phase B, with four changes. Read the `interrogate reviewers` line in place of `arena runners`; if the file or line is missing, default to `anthropic/claude-opus-5-5:xhigh` and `openai/gpt-6.1-sol:high`. In each prompt, give the original workspace path and tell the adversary to copy the scope's uncommitted changes into its output location before reviewing. Spawn each adversary with the `Agent` tool as `subagent_type: "general-purpose"`. In place of the arena task and rationale, give each adversary the scope, the intent, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own output location. For worktree runs, ensure copied changes and repro files are included in the result branch, staging ignored files if needed, and report repro paths relative to its root. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

## Verify

Verify each finding per arena Phase F by rerunning its command. For worktree results, rerun in a fresh worktree of the result branch, or against the original scope when no branch was produced; the agent's worktree is removed on completion. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause.

Skip arena Phases C, D, and E. Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.

## Output

- **Intent**: the restatement.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive.
- **Dropped**: for each adversary, the count of dropped findings and why.
