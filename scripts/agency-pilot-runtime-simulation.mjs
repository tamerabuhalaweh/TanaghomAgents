// One reproducible, entirely local journey per profile/language. No env loading.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareAgencyInvocation, validateAgencyResult, prepareBrandReview, validateBrandReview,
  buildExecutiveReport } from '../packages/agent-runtime/agency-pilot.mjs';
import { existingFixture, brandFixture, reportFixture, now } from '../tests/fixtures/agency-pilot.mjs';

const workflow = JSON.parse(readFileSync(new URL('../n8n/workflows/phase7d/proposal-executor.v1.json', import.meta.url)));
const build = new Function('$json', workflow.nodes.find(n => n.name === 'Build Fixed Proposal Request').parameters.jsCode);
const normalize = new Function('$json', '$', workflow.nodes.find(n => n.name === 'Normalize Proposal Result').parameters.jsCode);
const outcomes = [];
for (const language of ['en', 'ar']) {
  for (const code of ['social_media_strategist', 'content_creator', 'discovery_coach', 'support_responder']) {
    const f = existingFixture(code, language);
    const prepared = prepareAgencyInvocation(code, f.claim, f.snapshot, now);
    const built = build(prepared.claim)[0].json;
    const response = { statusCode: 200, body: { choices: [{ message: { content: JSON.stringify(f.output) } }] } };
    const normalized = normalize(response, () => ({ first: () => ({ json: built }) }))[0].json;
    assert.equal(normalized.outcome, 'succeeded');
    const result = validateAgencyResult(prepared, JSON.parse(normalized.result.output_json), f.snapshot, now);
    assert.equal(result.external_action_count, 0);
    outcomes.push({ code, language, result: 'PASS', input_hash: result.input_hash, output_hash: result.output_hash,
      worker: prepared.claim.executor_ref, human_approval_granted: false });
  }
  const b = brandFixture(language);
  const p = prepareBrandReview(b.input, b.snapshot, now);
  const brand = validateBrandReview(p, { language, findings: p.precheck.findings, questions: [] }, b.input, b.snapshot, now);
  outcomes.push({ code: 'brand_guardian', language, result: 'PASS', findings: brand.findings.length,
    semantic_status: brand.semantic_status, human_approval_granted: false });
  const f = reportFixture(language), report = buildExecutiveReport(f.input, f.snapshot, now);
  outcomes.push({ code: 'executive_summary', language, result: 'PASS', metrics: report.metrics.length,
    data_gaps: report.data_gaps.length, human_approval_granted: false });
}
assert.equal(outcomes.length, 12);
const evidence = { contract_version: 'phase7.agency-simulation-evidence.v1', result: 'PASS',
  fixture_clock: new Date(now).toISOString(), journeys: outcomes, actual_model_calls: 0, provider_calls: 0,
  database_writes: 0, n8n_service_executions: 0, n8n_code_nodes_executed_in_nodejs: 16,
  quality_certified: false, production_installed: false };
if (process.argv.includes('--verify-evidence')) {
  const retained = JSON.parse(readFileSync(new URL('../docs/evidence/2026-09-06-agency-runtime-simulation.json', import.meta.url)));
  assert.deepEqual(evidence, retained, 'Committed synthetic evidence no longer reproduces');
}
console.log(JSON.stringify(evidence, null, 2));
