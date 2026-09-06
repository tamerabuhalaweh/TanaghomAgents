import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseOrganizationSkillDraft } from '../apps/dashboard/lib/server/skill-library-validation.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const json = relative => JSON.parse(read(relative));
const sha = relative => createHash('sha256').update(read(relative), 'utf8').digest('hex');
const expectedTargets = {
  social_media_strategist: 'create_campaign_strategy',
  content_creator: 'generate_content_drafts',
  brand_guardian: null,
  discovery_coach: 'propose_conversation_reply',
  support_responder: 'propose_conversation_reply',
  executive_summary: null,
};
const commonBlockers = [
  'tenant_evidence_and_owner_review_required', 'versioned_binding_not_installed',
  'paired_evaluation_pending', 'model_compatibility_probe_pending', 'live_promotion_not_authorized',
];
const keys = (object, expected) => assert.deepEqual(Object.keys(object).sort(), [...expected].sort());

export function readAgencyPilotManifest() {
  return json('config/agency-pilot-candidates.v1.json');
}

// Offline candidate checks only. No model, database, credential, or network access.
// These assertions are not a substitute for runtime policy or semantic evaluation.
export function validateAgencyPilot(manifest = readAgencyPilotManifest(), draftOverrides = {}) {
  keys(manifest, ['contract_version', 'scope', 'recorded_at', 'epic', 'review_issue',
    'pilot_issue', 'evaluation_issue', 'upstream_commit', 'inventory_ref', 'license_ref',
    'model_execution', 'model_binding', 'runtime_installed', 'provider_execution_allowed',
    'references', 'profiles']);
  assert.equal(manifest.contract_version, 'tanaghom.agency-pilot-candidates.v1');
  assert.equal(manifest.scope, 'source_candidates_only');
  assert.deepEqual([manifest.epic, manifest.review_issue, manifest.pilot_issue, manifest.evaluation_issue], [174, 175, 176, 177]);
  assert.equal(manifest.inventory_ref, 'docs/planning/agency-expansion/catalog.v1.json');
  assert.equal(manifest.license_ref, 'docs/planning/agency-expansion/UPSTREAM_LICENSE.txt');
  const catalog = json(manifest.inventory_ref);
  assert.equal(manifest.upstream_commit, catalog.upstream.commit);
  assert.equal(sha(manifest.license_ref), catalog.upstream.license_sha256);
  assert.equal(manifest.model_execution, 'not_performed');
  assert.equal(manifest.model_binding, null);
  assert.equal(manifest.runtime_installed, false);
  assert.equal(manifest.provider_execution_allowed, false);
  assert.deepEqual(manifest.profiles.map(p => p.code).sort(), Object.keys(expectedTargets).sort());
  assert.equal(new Set(manifest.profiles.map(p => p.source.path)).size, 6);

  const registry = json('config/skill-registry.v1.json');
  const schemaPath = 'packages/contracts/schemas/phase7/organization-skill-draft.v1.schema.json';
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validateDraft = ajv.compile(json(schemaPath));
  const expectedRefs = new Set([schemaPath,
    'packages/contracts/schemas/phase7/agent-runtime-plan.v1.schema.json',
    'prompts/policy-resolved-agent/v1.md']);

  for (const profile of manifest.profiles) {
    keys(profile, ['code', 'display_name', 'owner_issues', 'source', 'review', 'candidate',
      'proposed_target', 'available', 'activated', 'certified', 'blockers']);
    keys(profile.source, ['path', 'git_blob_sha1', 'content_sha256', 'url']);
    keys(profile.candidate, ['path', 'sha256', 'content_hash']);
    keys(profile.review, ['status', 'reviewer', 'retained', 'removed']);
    assert.equal(profile.review.status, 'normalized_candidate_only');
    assert(profile.review.retained.length >= 2 && profile.review.removed.length >= 4);
    assert(profile.owner_issues.includes(176));
    for (const flag of ['available', 'activated', 'certified']) assert.equal(profile[flag], false);
    const source = catalog.profiles.find(p => p.path === profile.source.path);
    assert.equal(source?.planned_wave, 'pilot-candidate', `Not a selected source: ${profile.code}`);
    assert.equal(profile.display_name, source.name);
    assert.equal(profile.source.git_blob_sha1, source.git_blob_sha1);
    assert.equal(profile.source.content_sha256, source.content_sha256);
    assert.equal(profile.source.url, source.source_url);

    const expectedPath = `skills/pilots/agency-v1/${profile.code}.skill.json`;
    assert.equal(profile.candidate.path, expectedPath);
    assert.equal(sha(expectedPath), profile.candidate.sha256, `Candidate byte drift: ${profile.code}`);
    const draft = draftOverrides[profile.code] ?? json(expectedPath);
    assert(validateDraft(draft), JSON.stringify(validateDraft.errors));
    const parsed = parseOrganizationSkillDraft(draft);
    assert.equal(parsed.content_hash, profile.candidate.content_hash, `Candidate contract drift: ${profile.code}`);
    assert.equal(draft.code, `agency_${profile.code}`);
    assert.equal(draft.display_name, profile.display_name);
    assert.equal(draft.skill_class, 'proposal_instruction');
    assert.deepEqual(draft.languages, ['en', 'ar']);
    assert.deepEqual(draft.references, []); // Tenant evidence is intentionally not invented.
    assert.equal(draft.examples.length, 2);
    assert(draft.examples.some(example => /[\u0600-\u06ff]/u.test(example)));
    assert.match(draft.instructions, /proposal only/i);

    const targetCode = expectedTargets[profile.code];
    assert.deepEqual(profile.blockers, targetCode ? commonBlockers : ['output_contract_and_executor_missing', ...commonBlockers]);
    if (targetCode === null) {
      assert.equal(profile.proposed_target, null, 'A missing executor must not be invented');
      continue;
    }
    const skill = registry.skills.find(s => s.code === targetCode);
    const target = profile.proposed_target;
    keys(target, ['role_code', 'worker_code', 'platform_skill_code', 'platform_skill_version_id',
      'platform_skill_content_hash', 'executor', 'input_schema_ref', 'output_schema_ref']);
    assert.equal(target.platform_skill_code, skill.code);
    assert.equal(target.platform_skill_version_id, skill.version.id);
    assert.equal(target.platform_skill_content_hash, skill.version.content_hash);
    assert.deepEqual(target.executor, skill.version.executor);
    assert(skill.bindings.some(b => b.role_code === target.role_code && b.worker_code === target.worker_code));
    assert.equal(target.input_schema_ref, skill.version.input_schema_ref);
    assert.equal(target.output_schema_ref, skill.version.output_schema_ref);
    for (const ref of [skill.version.input_schema_ref, skill.version.output_schema_ref, skill.version.package_path]) expectedRefs.add(ref);
  }
  assert.deepEqual(manifest.references.map(ref => ref.path).sort(), [...expectedRefs].sort());
  for (const ref of manifest.references) {
    keys(ref, ['path', 'sha256']);
    assert.equal(sha(ref.path), ref.sha256, `Pinned reference drift: ${ref.path}`);
  }
  return { result: 'PASS', candidates: 6, existing_worker_mappings: 4, missing_executor_mappings: 2,
    enabled_candidates: 0, model_calls: 0, provider_calls: 0, quality_certification: 'not_performed' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(validateAgencyPilot()));
}
