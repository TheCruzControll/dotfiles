# Integrated orchestrator verification

## Historical result (before completion-gate correction)

Coordinator original-location run `ba369e369` exited 0. This run did not prove
accepted workflows could complete; its negative-only proof gate was unusable:

| Package | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| automatic-workflows | 78 | 0 | 0 |
| verified-workflows evidence tests | 13 | 0 | 0 |
| workflow-observer | 22 | 0 | 0 |
| herdr-hybrid | 331 | 0 | 0 |
| durable-handoff | 19 | 0 | 0 |
| Total | 463 | 0 | 0 |

Automatic-workflows and observer syntax checks, explicit continuation/evidence module syntax, and `git diff --check` passed in the same command. Log: `/Users/franciscruz/playground/mega-dev/.pi/tasks/01a19ef2-3eea-7479-8596-40b1af5a48a9-26355/ba369e369.output`.

Commands used the installed Node/Pi dependencies read-only, with no dependency installation. Parent-controller fixtures unset inherited child identity. Handoff integration used isolated HOME, the installed Pi SessionManager/todo replay, and the final original-location automatic-workflows core. These are actual extension adapter calls with mocked command contexts, not a live session replacement.

## Regressions and review

Independent source review found two blocking ownership issues in the first implementation: ancestor exports could create multiple valid owners, and same-destination transfer replay could reset counters. Task-wide durable generation arbitration and fail-closed repeated imports replaced per-ticket-only claims. Both new replay regression tests were run against the old implementation and failed on the expected safety assertions (`b5ce646d6`); repaired full suite passed independently (`be1fa72c3`). Subprocess tests exercise competing claims, not general crash certification.

The original merge preserved evidence bindings and ownership generation, keeps original candidate-adapter structured-error expectations, and includes both observer-event and rewind tests. The initial complete core suite caught nine thrown-error/structured-error contract regressions; these were repaired rather than weakening tests. A merged test run under `/tmp` failed the Darwin fence fixture because its deliberately denied sibling was inside allowed temporary storage; unchanged sources passed from a normal owned directory and from original package locations.

A weak abort test identified in independent review was strengthened to reach non-aborted settlement after an aborted assistant reply, then independently passed. Existing crash/closed-pane non-completion behavior was preserved rather than replaced.

## Completion-gate correction

The unusable proof gate, evidence-registration action and associated configuration
were removed. Existing ownership, child, approval, outstanding-check and recorded
external-acceptance safeguards remain. A production authenticated reader is
deferred, not a blocker for the agreed correction. The four-dimension projection
remains separate from completion. See `evidence-integration.md`.

The positive accepted-workflow regression failed against the old gate at
`assert.ok(!completed.isError)` (run `b47bbbca7`), demonstrating the actual defect.
Final correction run `b21cfb0f1` exited 0:

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| automatic-workflows | 78 | 0 | 0 |
| durable-handoff (host integrations enabled) | 19 | 0 | 0 |
| Total | 97 | 0 | 0 |

Core coverage includes accepted completion and restored cleanup, rejected/pending
states, owner approval, unresolved children and outstanding checks. Handoff tests
include the installed Pi SessionManager/todo replay and actual core adapter
transfer with counter preservation and replay rejection. Syntax checks and
`git diff --check` passed. Dependencies were resolved read-only from installed Pi;
handoff tests used isolated HOME. No install, live replacement or activation ran.
Log: `/Users/franciscruz/playground/mega-dev/.pi/tasks/01a1a05f-5dfd-7479-8596-40b844034a59-26355/b21cfb0f1.output`.

The earlier 463-test run is historical, not a claim that every sibling package
was rerun for this narrow correction.

## Operational limits

No live reload, provider call, external acceptance, deployment, commit, automatic dependency installation, or crash certification was performed. The 45% handoff threshold and pre-existing settings modification were preserved. New code is integrated into global package source but not activated in the current process. Authenticated production proof validation is not provided by this correction. Historical/stale branches, repeated imports and orphan ownership locks fail closed and may require manual reconciliation.
