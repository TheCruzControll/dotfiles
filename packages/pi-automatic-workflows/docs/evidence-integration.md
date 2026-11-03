# Completion and evidence boundaries

`workflow_update` completion/cleanup uses the existing `completionGate`: external
state must be `accepted`, and all checks must be cancelled or expired. Active or
unresolved owned children also block stage mutation. Failed checks leave the stage
unchanged. Approval-needed state still requires explicit owner approval before
another outcome can be recorded. These are controller state safeguards, not
authenticated proof of external acceptance.

The unfinished `completionEvidenceGate`, its `evidence` registration action and
artifact/requirements/proofs configuration have been removed. Its resolver always
returned unavailable, making even accepted workflows impossible to finish. Old
ledger fields do not enable that removed gate; no evidence records are migrated
or erased. Verification and correction recording remain supported.

The separate verified-workflows four-dimension validity projection (local,
transport, content, external acceptance) remains available for advisory use. It is
not wired into completion and does not establish authenticated positive proof.
A production reader is deferred to a separate concrete integration requiring
source provenance, integrity, freshness, artifact revision, and operation/input
binding. Model `verified:true`, arbitrary JSON, HTTP delivery and test passes must
not be presented as authenticated external acceptance.

Owner friction facts use the observer's existing `workflow:evidence` envelope with
stable SHA-256 incident IDs/opaque refs: blocked completion, unresolved children,
repeated equivalent failures, equivalent reselection and due checks while busy.
No raw inputs, errors, credentials, response references or model output are emitted.
Observer events are advisory; they do not grant completion authority.

Adapter fixtures cover rejected/pending states, approval, outstanding checks,
accepted completion, and cleanup after restoration. These are local simulation
checks, not live acceptance or crash/race certification.
