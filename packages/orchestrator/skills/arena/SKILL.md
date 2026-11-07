---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /skill:arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Use the `todo` tool to open one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Use the `arena runners` line injected from `~/.pi/agent/orchestrator-models.md`; if it is not in context, read the file. If the file or that line is missing, default to one each on `anthropic/claude-opus-5-5:xhigh` and `openai/gpt-6.1-sol:high`. Pass the `provider/model` as `model` and the suffix as `thinking` to `Agent`. An `auto` or `inherit-parent` entry in this line means the parent model, so omit `model` and `thinking` for it. Families go by model name after the provider: `claude-*` and `gpt-*` are separate families. If `Agent` rejects a configured entry or falls back to the parent model, run that seat on its family's default and say so. If the family has no default, or that default is rejected or falls back, use the closest available model of the same family, or drop the seat and say so when there is none. If dropped seats leave fewer than two runners, add runners until there are two, or one when the line has one entry. Run each added runner on a remaining runner's model and thinking level, or omit `model` and `thinking` so it runs on the parent model when none remain, and say so. Spawn more runners when the arena covers multiple design directions. Use the same model N times when the work is generation-bound rather than judgment-sensitive. Pick each subagent's reasoning level for the job, per the Subagents section of `skills/orchestrator/SKILL.md` in the installed package; read and follow it.
4. Give each candidate its own output location (a git worktree with `isolation: "worktree"` where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per `skills/principle-separate-before-serializing-shared-state/SKILL.md` in the installed package; read and follow it. For worktrees, put artifacts at non-ignored paths inside the worktree and record each result's branch and artifact paths; the worktree is removed on completion. Include shared grounding absent from the worktree in the prompt or at an accessible path.

## Phase B: Fan out

Spawn all N subagents with the `Agent` tool in one message, using `subagent_type: "general-purpose"`, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected. Agents run in the background by default.

For each worktree candidate, export its artifacts from the result branch to a candidate-specific path for the judge and your reading. If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one model from the `arena cross-judge pool` line in `~/.pi/agent/orchestrator-models.md`. If the file or that line is missing, choose from `anthropic/claude-opus-5-5:xhigh` and `openai/gpt-6.1-sol:high`. Spawn one judge with `Agent`, using `subagent_type: "Explore"` and a prompt that says not to edit files. Pass the model and thinking level as in Phase A. The judge is never from the parent's family, as Phase A step 3 defines families. Try only the entries from another family, in pool order. An `auto` or `inherit-parent` entry is the parent model, so it never judges. With the default pool, a Claude parent gets `openai/gpt-6.1-sol:high`. A parent from any other family gets `anthropic/claude-opus-5-5:xhigh` first. If `Agent` rejects an entry or falls back to the parent model, say so and try the same model at the closest available thinking level, or move to the next entry when there is none. If no entry from another family runs, try the default pool's entries from another family the same way. If none of those runs, skip the judge, pick the base alone in Phase D, and say so. If you do not know the parent's model, try the pool's configured models in pool order and say that the family check did not run. The judge sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with your reading in Phase D. Don't spawn it while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per `skills/principle-laziness-protocol/SKILL.md` in the installed package; read and follow it.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per `skills/principle-redesign-from-first-principles/SKILL.md` in the installed package; read and follow it so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per `skills/principle-prove-it-works/SKILL.md` in the installed package; read and follow it. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
