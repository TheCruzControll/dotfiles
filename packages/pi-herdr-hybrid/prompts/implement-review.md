---
description: Implement then independently review through an interactive chain
---
Task: $ARGUMENTS
Use subagent_workflow chain with worker then reviewer. Give the worker scope and acceptance tests; require evidence in its completion summary. Give the reviewer a read-only correctness review using prior-step evidence and direct inspection. Only explicit completion advances the chain. The parent evaluates findings and explicitly requests any follow-up; do not silently loop retries or equate completion with acceptance.

Require the worker to include a complete diff artifact path (requested base/range, tracked changes, and untracked additions) in its completion summary for the shell-free reviewer. If unavailable, use a worker-only workflow, then have the parent capture the diff artifact and launch reviewer fresh with that path. A missing artifact blocks diff-review acceptance; direct inspection alone is not a complete diff review.
