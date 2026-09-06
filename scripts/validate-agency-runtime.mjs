import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8').replaceAll('\r\n', '\n');
const json = p => JSON.parse(read(p));
const schemas = ['asset-rights', 'brand-input', 'brand-model-output', 'brand-review', 'brand-rule',
  'evidence-snapshot', 'executive-report', 'metric-observation', 'report-input'];
export function requiredAgencyRuntimeReferences() {
  const candidates = json('config/agency-pilot-candidates.v1.json');
  return [...new Set(['config/agency-pilot-candidates.v1.json', 'config/skill-registry.v1.json',
    'packages/agent-runtime/agency-pilot.mjs', 'n8n/workflows/phase7d/proposal-executor.v1.json',
    ...schemas.map(name => `packages/contracts/schemas/phase7/agency-${name}.v1.schema.json`),
    ...candidates.references.map(r => r.path), ...candidates.profiles.map(p => p.candidate.path)])].sort();
}
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
export function validateAgencyRuntime(manifest = json('config/agency-runtime-bindings.v1.json')) {
  keys(manifest, ['contract_version', 'candidate_manifest_ref', 'production_enabled', 'model_calls_authorized',
    'provider_execution_allowed', 'module', 'profiles', 'references']);
  assert.equal(manifest.contract_version, 'tanaghom.agency-runtime-bindings.v1');
  assert.equal(manifest.candidate_manifest_ref, 'config/agency-pilot-candidates.v1.json');
  assert.equal(manifest.module, 'packages/agent-runtime/agency-pilot.mjs');
  for (const flag of ['production_enabled', 'model_calls_authorized', 'provider_execution_allowed']) assert.equal(manifest[flag], false);
  const candidates = json(manifest.candidate_manifest_ref);
  assert.deepEqual(manifest.profiles.map(p => p.code).sort(), candidates.profiles.map(p => p.code).sort());
  for (const p of manifest.profiles) {
    keys(p, ['id', 'code', 'procedure_hash', 'kind', 'role_code', 'worker_code', 'skill_code',
      'platform_skill_version_id', 'input_schema_ref', 'output_schema_ref', 'adapter_export',
      'operating_mode', 'production_installed', 'certified']);
    const candidate = candidates.profiles.find(c => c.code === p.code), t = candidate.proposed_target;
    assert.equal(p.id, `agency.${p.code}.v1`);
    assert.equal(p.procedure_hash, candidate.candidate.content_hash);
    assert.equal(p.operating_mode, 'simulation');
    assert.equal(p.production_installed, false); assert.equal(p.certified, false);
    assert.equal(p.kind, t ? 'existing_proposal' : 'local_proposal');
    assert.equal(p.worker_code, t?.worker_code ?? null);
    assert.equal(p.skill_code, t?.platform_skill_code ?? null);
    assert.equal(p.platform_skill_version_id, t?.platform_skill_version_id ?? null);
    assert.equal(p.role_code, t?.role_code ?? (p.code === 'brand_guardian' ? 'content_producer' : 'publisher_monitor'));
    assert.equal(p.input_schema_ref, t?.input_schema_ref ?? `packages/contracts/schemas/phase7/agency-${p.code === 'brand_guardian' ? 'brand' : 'report'}-input.v1.schema.json`);
    assert.equal(p.output_schema_ref, t?.output_schema_ref ?? `packages/contracts/schemas/phase7/agency-${p.code === 'brand_guardian' ? 'brand-review' : 'executive-report'}.v1.schema.json`);
    assert.equal(p.adapter_export, t ? 'prepareAgencyInvocation' : p.code === 'brand_guardian' ? 'reviewBrandContent' : 'buildExecutiveReport');
  }
  assert.deepEqual(manifest.references.map(r => r.path).sort(), requiredAgencyRuntimeReferences());
  for (const reference of manifest.references) {
    keys(reference, ['path', 'sha256']);
    assert.equal(createHash('sha256').update(read(reference.path)).digest('hex'), reference.sha256, `Reference drift: ${reference.path}`);
  }
  return { result: 'PASS', callable_bindings: 4, local_adapters: 2, production_installed: false, quality_certified: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(validateAgencyRuntime()));
