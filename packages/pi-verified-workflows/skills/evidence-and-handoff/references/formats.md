# Existing CLI formats and examples

Commands in this reference assume the package root; from another project use the absolute script paths resolved from the skill directory. This reference documents existing helper schemas, not new capabilities.

# evidence-and-handoff

Use this skill when you need to validate local evidence records or decide whether a prior submission can be retried safely.

## What this lane owns
- `scripts/evidence/check.mjs` validates evidence manifest structure, claim references, and local artifact pointers.
- `scripts/evidence/submission-check.mjs` validates task, fresh-state, and receipt relationships before another submission.

## Evidence manifest expectations
Record integrity only: these checks confirm that references, revisions, and file pointers are coherent. They do **not** prove the truth of a claim.

### Supported claim kinds
- `source_assertion`: source-backed statement with `source.path`, `source.revision`, and `source.locator`.
- `derived_computation`: computed result with `input_claims[]`, a `computation` method/formula/command, and an output pointer.
- `observed_render`: browser or renderer observation with `observed_at`, `render.page`, `render.locator`, and `render.capture`.
- `researcher_inference`: analyst conclusion with `input_claims[]` and a written `rationale`.

### Evidence CLI examples
```sh
node ./scripts/evidence/check.mjs --manifest ./evidence/manifest.json
node ./scripts/evidence/check.mjs --manifest ./evidence/manifest.json --claim C3 --require-kind observed_render
```

Guardrails:
- keep revisions explicit when known
- allow `unknown` only when the record really cannot identify a revision
- prefer hashed file references for source, computed output, and captures
- never treat a matching computation as proof of a rendered result

## Submission gate expectations
Use `submission:check` before another submission when you already have:
- the current task handoff record
- a freshly re-read authoritative state record
- the most recent submission receipt

### Required outcomes
Receipts and fresh-state feedback must classify the prior result as one of:
- `accepted`
- `rejected`
- `pending`
- `unknown`

### Submission CLI example
```sh
node ./scripts/evidence/submission-check.mjs \
  --task ./handoff/task.json \
  --state ./handoff/fresh-state.json \
  --receipt ./handoff/receipt.json
```

Guardrails:
- stop when task review is older than the latest feedback
- stop unchanged retry loops after a rejection
- stop when task/state/receipt identities disagree or the outcome is ambiguous
- treat accepted receipts as a no-op rather than a reason to resubmit

## Output contract
Both CLIs:
- support `--help`
- emit machine-readable JSON to stdout
- write human diagnostics to stderr
- exit `0` for success or approved no-op
- exit `2` for expected guardrail stops
- exit `1` for unexpected internal failures
