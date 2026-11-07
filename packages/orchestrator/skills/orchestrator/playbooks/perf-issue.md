### Perf issue

**You own the measurement story. Plan, review, verify the numbers.** Tie every fix to a measurement, don't read source instead of measuring.

1. Capture a baseline trace via the matching control skill, reading and following it. Read and follow the [**benchmark-checklist**](../../benchmark-checklist/SKILL.md) skill to vet the baseline and each later number.
2. Read and follow [**how**](../../how/SKILL.md) to ground hypotheses. Don't claim a perf ceiling without running it first.
   Try the performance mantras in order, cheapest first:
   1. Don't do it. Stop work whose result nothing uses rather than cheapening it.
   2. Do it, but don't do it again.
   3. Do it less.
   4. Do it later.
   5. Do it when they're not looking.
   6. Do it concurrently.
   7. Do it cheaper.

   When an earlier mantra meets the target, stop.
3. Plan the fix from the trace. If it crosses a function boundary, read and follow [**architect**](../../architect/SKILL.md) first. Delegate implementation using `Agent` with `subagent_type: "orchestrator-agent"` and your configured perf-issue model (default `openai/gpt-6.1-terra:high`). If role lines aren't in context, read `~/.pi/agent/orchestrator-models.md`. Split the role's `provider/model:thinking` value into the `model` and `thinking` fields; omit both for `inherit-parent` or `auto`. Pick each subagent's reasoning level for the job, per the Subagents section. Review the diff. Capture a post-fix trace.
   Read and follow the [**sequence-verifiable-units**](../../principle-sequence-verifiable-units/SKILL.md) principle skill, verifying each attempt before trying the next.
4. Parse and compare the artifacts (JSON to sqlite, diff). "Inconclusive" or wrong-surface is not a pass. Flag it.
5. Cite the measurement in the PR.
6. Read and follow [**Opening a PR**](opening-a-pr.md).

For sustained improvement against a metric rather than a one-off fix, use the [Hillclimb playbook](hillclimb.md).

**Reply:** baseline number, post-fix number, delta, artifact path.
