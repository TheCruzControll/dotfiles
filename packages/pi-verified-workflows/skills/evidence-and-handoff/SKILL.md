---
name: evidence-and-handoff
description: Checks evidence records and submission receipts before claiming acceptance or retrying a rejected submission. Not for resuming project memory; use durable-record for that.
---

# Evidence and submission gate

A matching number, successful command, or old handoff is not proof of rendered output or external acceptance.

Resolve `<package>` as `../..` from this skill directory. Read `references/formats.md` and the relevant checker before preparing records; the implemented schema, not an invented equivalent, is the input contract.

## Choose the gate

- Evidence: `node <package>/scripts/evidence/check.mjs --manifest <absolute-path>`. To require browser/render evidence for a claim, add `--claim <id> --require-kind observed_render`.
- Submission: `node <package>/scripts/evidence/submission-check.mjs --task <absolute-path> --state <absolute-path> --receipt <absolute-path>`.

## Keep the distinctions

Record source assertions, derived computations, observed renders, and researcher inferences as separate claim kinds. Preserve input revisions and artifact hashes; label unknown revisions explicitly. The validators check record consistency and file integrity, **not truth, authoritative freshness, or browser execution**. Do not invent missing evidence merely to pass them.

Before a retry, actually refresh authoritative instructions/status and compare them with the last receipt. An unchanged rejection needs a changed prerequisite, not another attempt. Pending or unknown outcomes require reconciliation; accepted receipts mean stop, not resubmit. A passing local gate is neither submission permission nor external acceptance.

Keep raw receipts/captures in restricted artifacts. Put only pointers, contradictions, and the next prerequisite in the durable record; use `durable-record` for its layout. For GitHub changes, hand off to the explicit `github-issue-lifecycle` workflow rather than treating a gate result as permission to publish.
