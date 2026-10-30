---
name: council-mode
description: Run a bounded parent-supervised advisor council when the user asks for council mode, advisors, cross-examination, or /council.
---
# Bounded council

Read `references/pass-contracts.md` before launching. This is advice, not implementation authority or free-form agent chat.

The parent selects the roster, relays curated claims, judges validity, and writes the memo. Advisors remain read-only and do not see peer transcripts by default.

## Roster and brief

Use `subagents_list` to discover profiles. Prefer 2–3 `council-*` advisors; never exceed four. If fewer than two exist, use `oracle` and `reviewer`. Fork fallback oracle (`context: "fork"`); use reviewer fresh. If fewer than two executable advisors remain, label degraded single-advisor mode.

Write the question, scope, non-goals, evidence targets, roster, known context modes, and pass cap. Tell the user the roster and pass cap. Default to two passes; allow a third only when explicitly requested and material evidence can settle a dispute.

## Execution

1. Launch independent Pass 1 reports using `subagent_workflow` with `action: "start"`, `mode: "parallel"`, and one step per advisor. Each step has a stable `key`, `agent`, `task`, and optional `context`. Put the Pass 1 JSON report shape from the reference in the task. Ask for the JSON as the explicit completion summary. No programmable workflow script or `outputSchema` API is available.
2. Keep advisors read-only; do not ask them to spawn children. Supply evidence they cannot access. Use only tools supported by their profiles.
3. Wait for the workflow's explicit aggregate completion receipt. Inspect individual results and session paths; a ping, user exit, crash, or missing completion is not successful evidence. A blocked pass requires an explicit parent/user-directed recovery, not automatic advancement.
4. Report completion count, agreements, disputes, and whether cross-examination is needed. Build the claim matrix in the parent. Relay at most five material claims per advisor, never entire peer transcripts.
5. For Pass 2, explain the selected disputes and resume advisors with `subagent_resume` using retained `sessionFile` as `sessionPath` and a curated `message`. Include only disputed claims, conflicting evidence, missing proof, high-impact risks, and owner decisions. Attribute peer material as “another advisor”. Use the Pass 2 JSON shape from the reference. Record new result/session identifiers. If resume is unavailable, use the same profile fresh with its prior report and challenge packet, and label that fallback.
6. Stop at convergence, pass cap, failed recovery, or user interruption. A third pass follows the same resume procedure using the latest sessions. Never add a pass for polish.

The workflow controller handles parallel Pass 1 aggregation; the parent tracks cross-exam receipts and bounded progression. Copy upstream Herdr interaction: interactive child panes, explicit completion/ping, resume/interrupt, and clean-exit auto-close. There is no custom takeover approval gate.

## Memo

Convergence means no recommendation-changing dispute remains that advisor evidence could settle. Put other disputes in owner decisions.

Write: question/scope; recommendation/rationale; accepted and rejected feedback with reasons; owner decisions; evidence and child/session IDs; confidence and what would change it; roster, passes, fallbacks, and known context modes. Identify profiles by name. Note forked fallback oracle. Escalate to a writer only if requested.
