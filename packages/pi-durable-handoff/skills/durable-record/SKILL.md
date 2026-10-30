---
name: durable-record
description: Resumes work from a durable handoff and maintains lean project memory across sessions. Use for continuation records, not evidence or acceptance validation; use evidence-and-handoff for that.
---

# Durable record

Continuity fails when the next session has to reconstruct decisions from a transcript.

## Resume with minimum context

1. Read the supplied `handoff.md` first; it is the continuation index.
2. Follow its exact next step. Read `decisions.md`, `failures.md`, or `tasks.md` only when that step needs them.
3. If current authoritative state contradicts the record, reconcile the discrepancy; the handoff preserves memory, not proof of current external state.
4. Preserve the user's acceptance conditions, non-goals, and stopping point. A handoff or "continue until finished" does not authorize a larger task. Review suggestions are not new requirements: fix demonstrated in-scope failures, defer optional hardening, and stop when the agreed checks pass. If a required check is blocked, report it rather than inventing replacement work.

## Maintain the record

- `handoff.md`: objective, active constraints, exact next step, decisions still affecting it, top do-not-retry notes, essential paths.
- `decisions.md`: only choices that still matter, their rationale, and rejected alternatives.
- `failures.md`: reusable failures, the signal that proved them, and what new evidence would justify retrying.
- `tasks.md`: optional; only live tasks, blockers, and next actions that the handoff cannot express clearly.

Keep one home for each fact. Update a bullet instead of appending a narrative, link restricted evidence instead of copying it, and archive stale detail. The next handoff should be no larger than the current one unless new constraints genuinely require it; preserve rationale in references rather than dropping it to meet a size target.
