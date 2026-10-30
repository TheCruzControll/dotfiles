# pi-verified-workflows

Reusable Pi package for three explicit, on-demand workflows:

- source-backed document preview/render inspection
- evidence and submission/freshness checks
- approval-gated GitHub issue planning and apply helpers

## Status

This package is now scaffolded and validated as a local Pi package.

Current v1 status:
- `source-preview` is a guardrail-first validator/planner only. Real rendering is not implemented; adding toolchain dependencies alone does not enable it.
- `evidence-and-handoff` validates evidence manifests and submission freshness/receipt records.
- `github-issue-lifecycle` plans and applies approval-gated GitHub issue mutations with fixture-backed tests; no live GitHub writes are performed by package tests.

## Skills

- `source-preview`
- `evidence-and-handoff`
- `github-issue-lifecycle`

Skills route automatically by description except `github-issue-lifecycle`, which is explicit-only: `/skill:github-issue-lifecycle`. Invoking it permits planning, not unapproved publication. Reload Pi with `/reload` after skill edits.

Skill shaping notes and unexecuted routing test cases: `docs/skill-shaping-review.md`.

## Shared command surface

All helper entrypoints are local Node CLIs invoked from the package root:

- `npm run source-preview:check -- ...`
- `npm run source-preview:render -- ...`
- `npm run evidence:check -- ...`
- `npm run submission:check -- ...`
- `npm run github:plan -- ...`
- `npm run github:apply -- ...`

See `docs/contracts.md` for lane ownership, exit-code rules, JSON/stdout conventions, and the file layout each lane should follow.

## Test surface

The package uses Node's built-in test runner:

- `npm test`
- `npm run test:renderer`
- `npm run test:evidence`
- `npm run test:github`

Lane tests live under `tests/source-preview/`, `tests/evidence/`, and `tests/github/`.

## Personal registration

To make the package available across projects, register the local package with Pi:

```bash
# From this package directory:
pi install "$PWD"
```

Or add it directly to `~/.pi/agent/settings.json` under `packages`.

Because this is a Pi package, it can live in `mega-dev` while still loading personally across projects.
