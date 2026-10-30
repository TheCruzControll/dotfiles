# Implementation contracts

This file defines the shared package scaffold before lane work starts.

## Parent-owned files

Only the parent session should edit these shared integration files:

- `package.json`
- `README.md`
- `docs/contracts.md`
- personal Pi settings registration during final integration

## Lane ownership

Each implementation lane should stay inside its own subtree.

### Renderer lane

Owns:

- `skills/source-preview/`
- `scripts/source-preview/`
- `tests/source-preview/`

### Evidence lane

Owns:

- `skills/evidence-and-handoff/`
- `scripts/evidence/`
- `tests/evidence/`

### GitHub lane

Owns:

- `skills/github-issue-lifecycle/`
- `scripts/github/`
- `tests/github/`

## Shared CLI conventions

All CLIs are local Node ESM entrypoints (`.mjs`) run from the package root.

Every CLI must:

1. support `--help`
2. write machine-readable JSON to stdout
3. write diagnostics to stderr
4. avoid printing secrets or raw tickets by default
5. prefer file inputs over inline JSON for substantive payloads

### Exit codes

- `0`: success or approved no-op
- `2`: expected guardrail stop (`validation_failed`, `stale_state`, `unsupported`, `approval_required`, `ambiguous_result`)
- `1`: unexpected internal/tool failure

## Output shape

Successful stdout JSON should follow this envelope unless a lane documents a stricter subtype:

```json
{
  "ok": true,
  "operation": "source-preview:render",
  "summary": "Rendered 1 page",
  "artifacts": [],
  "warnings": []
}
```

Guardrail stops should still emit JSON to stdout:

```json
{
  "ok": false,
  "operation": "github:apply",
  "code": "stale_state",
  "summary": "Remote issue changed after approval",
  "artifacts": [],
  "warnings": []
}
```

## Lane-specific contract anchors

### `source-preview:check`

- validates a preview spec without executing source rendering
- confirms required roots/entries/layout mappings are present
- must distinguish trusted reviewed-local execution from unsupported inputs

### `source-preview:render`

- renders original source documents through the real adapter path
- preserves head/CSS/layout/component behavior in emitted artifacts
- records provenance for source snapshot, adapter/toolchain, and browser observation
- must not substitute handwritten HTML for rendered output

### `evidence:check`

- validates evidence manifests and claim references
- distinguishes `source_assertion`, `derived_computation`, `observed_render`, and `researcher_inference`
- validates record integrity only, not truth

### `submission:check`

- checks fresh-state/task/receipt records before another submission
- stops unchanged retry loops and ambiguous acceptance claims

### `github:plan`

- produces an exact local preview of intended GitHub mutations
- binds plan output to actor/target/precondition digest
- performs no remote writes

### `github:apply`

- requires an approved plan artifact
- re-reads preconditions before mutation, applies serially, and verifies write results
- stops on stale state or ambiguous outcomes rather than retrying blindly

## Test contracts

- Tests must use Node's built-in runner and live inside the owning lane subtree.
- Each lane should include fixture-driven tests for success, guardrail stops, and regression cases called out in research.
- Networked/live tests are out of scope for lane implementation unless the parent explicitly adds them later.
- Mock GitHub tests must prove preview-only mode, stale-state detection, serial apply, and read-after-write verification.
- Renderer tests must prove actual source-driven output changes when source data/component markup changes.

## Current package layout

```text
pi-verified-workflows/
├── package.json
├── README.md
├── docs/
│   └── contracts.md
├── skills/
│   ├── source-preview/
│   ├── evidence-and-handoff/
│   └── github-issue-lifecycle/
├── scripts/
│   ├── source-preview/
│   ├── evidence/
│   └── github/
└── tests/
    ├── source-preview/
    ├── evidence/
    └── github/
```
