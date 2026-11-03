import { isNonEmptyString, isRecord } from './common.mjs';

export const proofKinds = Object.freeze(['local', 'transport', 'content', 'external_acceptance']);

// Pure projection over owner-resolved existing records; never writes a second ledger.
export function evidenceValidity({ artifact, revision, requirements, proofs, resolve }) {
  if (![artifact, revision].every(isNonEmptyString) || revision === 'unknown'
      || !Array.isArray(requirements) || !requirements.length
      || requirements.some((kind) => !proofKinds.includes(kind))
      || !Array.isArray(proofs) || typeof resolve !== 'function') {
    throw new TypeError('Explicit artifact, revision, proof requirements and resolver required');
  }
  const valid = Object.fromEntries(proofKinds.map((kind) => [kind, []]));
  for (const proof of proofs) {
    if (!isRecord(proof) || !proofKinds.includes(proof.kind) || !isNonEmptyString(proof.ref)) continue;
    const record = resolve(proof.ref);
    if (!isRecord(record) || record.artifact !== artifact || record.revision !== revision) continue;
    // The resolver must validate provenance, hashes and freshness before setting verified.
    if (record.verified !== true) continue;
    let passed = false;
    switch (proof.kind) {
      case 'local': passed = record.type === 'local_check' && record.outcome === 'passed'; break;
      case 'transport': passed = record.type === 'transport' && record.delivered === true; break;
      case 'content': passed = record.type === 'content_check' && record.outcome === 'passed'
        && isNonEmptyString(record.assertionRef); break;
      case 'external_acceptance': passed = record.type === 'submission_receipt'
        && record.outcome === 'accepted' && isNonEmptyString(record.authorityRef)
        && isNonEmptyString(record.operation_id) && isNonEmptyString(record.input_digest); break;
    }
    if (passed && !valid[proof.kind].includes(proof.ref)) valid[proof.kind].push(proof.ref);
  }
  const missing = [...new Set(requirements)].filter((kind) => !valid[kind].length);
  return { artifact, revision, valid, missing, satisfied: missing.length === 0 };
}
