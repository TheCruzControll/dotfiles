import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceValidity, proofKinds } from '../../scripts/evidence/validity.mjs';

test('proof classes do not substitute for each other and remain revision scoped', () => {
  const records = {
    test: { type: 'local_check', outcome: 'passed' },
    http: { type: 'transport', delivered: true, status: 200 },
    body: { type: 'content_check', outcome: 'passed', assertionRef: 'assert-1' },
    receipt: { type: 'submission_receipt', outcome: 'accepted', authorityRef: 'remote-1', operation_id: 'op-1', input_digest: 'sha-1' },
  };
  const check = (proofs, revision = 'r1') => evidenceValidity({ artifact: 'a1', revision,
    requirements: proofKinds, proofs,
    resolve: (ref) => records[ref] && ({ verified: true, artifact: 'a1', revision: 'r1', ...records[ref] }),
  });
  assert.deepEqual(check([{ kind: 'content', ref: 'http' }, { kind: 'external_acceptance', ref: 'test' }]).missing, proofKinds);
  const proofs = proofKinds.map((kind, i) => ({ kind, ref: Object.keys(records)[i] }));
  assert.equal(check(proofs).satisfied, true);
  assert.equal(check(proofs, 'r2').satisfied, false);
  for (const outcome of ['pending', 'rejected', 'unknown']) {
    records.receipt.outcome = outcome;
    assert.deepEqual(check(proofs).missing, ['external_acceptance']);
  }
  records.test.artifact = 'other-artifact';
  assert.deepEqual(check(proofs).missing, ['local', 'external_acceptance']);
  delete records.test.artifact;
  records.body.verified = false;
  assert.deepEqual(check(proofs).missing, ['content', 'external_acceptance']);
  assert.throws(() => evidenceValidity({ artifact: 'a1', revision: 'unknown' }), TypeError);
});
