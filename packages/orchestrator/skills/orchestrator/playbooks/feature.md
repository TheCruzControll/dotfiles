### Feature

**You own the design. Plan, review, verify.** Delegate implementation. Stay in the lead.

1. Read and follow [**how**](../../how/SKILL.md) over the affected subsystem.
2. Read and follow [**architect**](../../architect/SKILL.md) for parallel design exploration.
3. Write the throughput checkpoint as four items using the `todo` tool. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (read and follow the [**separate-before-serializing-shared-state**](../../principle-separate-before-serializing-shared-state/SKILL.md) principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Delegate code-writing using `Agent` with `subagent_type: "orchestrator-agent"`, your configured feature model (default `openai/gpt-6.1-terra:high`), and a specific scope (file paths, named data shape and its organizing structure per [**principle-model-the-domain**](../../principle-model-the-domain/SKILL.md), a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic, and success criteria). Read and follow that principle skill. Split the role's `provider/model:thinking` value into the `model` and `thinking` fields; omit both for `inherit-parent` or `auto`. Pick each subagent's reasoning level for the job, per the Subagents section. When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), read and follow the [**arena**](../../arena/SKILL.md) skill instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). A subagent forbidden to spawn satisfies this by owning the diff directly with the same review separation. No "standing by" reply that waits on a nested agent. Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass. Flag it.
6. Rebase into small, ordered commits. Stack follow-ups.
   Read and follow the [**sequence-verifiable-units**](../../principle-sequence-verifiable-units/SKILL.md) principle skill, building, verifying, and committing each small unit before the next.
7. If the design is contested, read and follow [**interrogate**](../../interrogate/SKILL.md) before shipping.
8. Read and follow [**Opening a PR**](opening-a-pr.md).

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline. That owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries. Spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, the throughput checkpoint, open decisions. Tables for design alternatives.
