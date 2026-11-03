# Core-owned completion integration

`evidenceValidity` in `scripts/evidence/validity.mjs` is a pure, synchronous
projection, not a completion gate, evidence store, network reader or truth oracle.
Existing manifest claims, workflow verification records and submission receipts
are not authenticated by this projection. No new database is required. Existing
CLIs are unchanged. Automatic-workflows does not currently integrate this helper;
its unfinished gate was removed. A production trusted reader is deferred.

Core supplies `{artifact, revision, requirements, proofs, resolve}`. `proofs` is
an array of `{kind, ref}` pointing at existing records; `resolve(ref)` returns a
validated projection (or undefined). Requirements must be nonempty and explicitly
selected by core from `local`, `transport`, `content`, `external_acceptance`.
No proof type implies another. Returned `{valid, missing, satisfied}` concerns only
those requirements and that exact artifact/revision, not general task completion.

Resolver projections all include `{artifact, revision, verified: true}` only after
checking source record integrity, provenance, freshness and digest binding:

| kind | projected existing record fields |
| --- | --- |
| local | `type: 'local_check', outcome: 'passed'` |
| transport | `type: 'transport', delivered: true` |
| content | `type: 'content_check', outcome: 'passed', assertionRef` |
| external_acceptance | `type: 'submission_receipt', outcome: 'accepted', authorityRef, operation_id, input_digest` |

These are ephemeral views of existing records, not a new persisted schema.
`assertionRef` identifies the actual content assertion/observation, never just an
HTTP status. `authorityRef` identifies authoritative external feedback, not a test
log. For receipts, core must bind the existing task/state/receipt target,
precondition, operation and input digest to the requested artifact/revision and
verify current authoritative acceptance. `submission:check` alone is a retry
freshness check, not proof of acceptance. Unsupported/unknown/missing records
must resolve to undefined or `verified: false`. A resolver exception propagates;
core must fail closed rather than treat it as acceptance.

Example (coordinator adapter pseudocode):

```js
const result = evidenceValidity({
  artifact: task.artifactId, revision: task.revision,
  requirements: ['local', 'content', 'external_acceptance'],
  proofs: task.existingEvidenceRefs, // [{kind, ref}], no copied record bodies
  resolve: ref => projectVerifiedExistingRecord(ref, task),
});
// Only automatic-workflows owns this gate and any continuation decision:
if (!result.satisfied) recordMissingEvidence(result.missing);
```

A future concrete integration would need to retain the existing completion
safeguards (children, transfer, safety, etc.). This isolated package does not hook
settlement, grant approval, perform submission or change automatic-workflows.
Local tests prove separation logic only, not external acceptance.
