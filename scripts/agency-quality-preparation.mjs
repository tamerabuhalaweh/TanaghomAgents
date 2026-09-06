// Offline preparation ONLY. No environment loading, DB, HTTP, shell or model transport.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prepareTask } from '../packages/agent-runtime/integration.mjs';
import { fingerprint } from '../packages/agent-runtime/agency-pilot.mjs';
import { validateAgencyRuntime, requiredAgencyRuntimeReferences } from './validate-agency-runtime.mjs';
import { existingFixture, brandFixture, reportFixture, id, observed, expires, now, metric, source } from '../tests/fixtures/agency-pilot.mjs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8').replaceAll('\r\n', '\n');
const json = p => JSON.parse(read(p));
export const corpus = json('evaluation/agency-v1/corpus.json');
export const rubric = json('evaluation/agency-v1/rubric.json');
const bindings = json('config/agency-runtime-bindings.v1.json');
const skills = json('config/skill-registry.v1.json').skills;
export const modelPlaceholder = 'UNAPPROVED-ISOLATED-MODEL-NOT-EXECUTABLE';
export const sourceBaseline = '3769d5ae7abe2e98d6e3d7ad612d30160f886e30';
export function requiredReferences() {
  return [...new Set([...requiredAgencyRuntimeReferences(), 'config/agency-runtime-bindings.v1.json',
    'packages/agent-runtime/integration.mjs', 'packages/agent-runtime/integration.d.ts',
    'packages/database/migrations/0034_agency_pilot_integration.up.sql',
    'n8n/workflows/agency-pilot/simulation.v1.json', 'tests/fixtures/agency-pilot.mjs',
    'evaluation/agency-v1/corpus.json', 'evaluation/agency-v1/rubric.json',
    'evaluation/agency-v1/RUNBOOK.md', 'evaluation/agency-v1/run-authorization.template.json',
    'tests/agency-quality-preparation.test.mjs',
    'scripts/agency-quality-preparation.mjs', 'scripts/validate-agency-runtime.mjs',
    'scripts/agency-pilot-integration.mjs', 'scripts/phase7d-runtime-certification-integration.mjs',
    'package-lock.json'])].sort();
}
export function lockManifest() {
  return { version: 'agency.quality-source-lock.v1', accepted_source_baseline: sourceBaseline,
    normalization: 'UTF-8 text, CRLF normalized to LF', references: requiredReferences().map(p =>
      ({ path: p, sha256: createHash('sha256').update(read(p)).digest('hex') })) };
}
export function verifyLock(manifest = json('evaluation/agency-v1/source-lock.json')) { assert.deepEqual(manifest, lockManifest(), 'Quality source/corpus/rubric drift requires a new reviewed freeze'); }

// These bundles are synthetic resolved fixtures, NOT an authentication mechanism.
// Actual execution must re-run the authenticated disposable lane from PR #196.
export function bundleFor(c) {
  const profile = bindings.profiles.find(p => p.code === c.profile); assert(profile, 'Unknown profile');
  const isConversation = ['discovery_coach','support_responder'].includes(c.profile);
  const f = profile.kind === 'existing_proposal' ? existingFixture(c.profile, c.language)
    : c.profile === 'brand_guardian' ? brandFixture(c.language) : reportFixture(c.language);
  const task = { id: id(3), organization_id: id(1), correlation_id: id(4), language: c.language,
    claimed_at: observed, created_at: observed, lease_expires_at: expires,
    idempotency_key: 'quality:' + c.id, options: {} };
  const data = { profile, binding: { profile_code: c.profile, organization_id: id(1) },
    agent: { organization_id: id(1), languages: ['en','ar'], lifecycle_state: 'simulation' },
    policy: { max_tokens: 8000, max_steps: 1, max_tool_calls: 1,
      allowed_record_types: ['campaign','content','conversation','report'], allowed_action_types: ['proposal.create'],
      allowed_channels: ['instagram','whatsapp'] },
    model: { model_name: modelPlaceholder }, assigned_skills: [{platform_skill_version_id: profile.platform_skill_version_id, operating_mode: 'shadow'}],
    evidence: [], records: {} };
  const putEvidence = s => data.evidence.push({ ...s, kind: s.kind, record: s.record, approved_at: observed, expires_at: expires });
  if (['social_media_strategist','content_creator'].includes(c.profile)) {
    data.records.campaign = { ...f.input.campaign, currency: 'USD', budget_target: 0,
      brief: c.facts + '\nUntrusted task request: ' + c.task, target_audience: {language: c.language} };
    if (c.profile === 'content_creator') data.records.strategy = f.input.strategy;
  } else if (isConversation) {
    const input = f.input, knowledge = structuredClone(input.retrieved_knowledge[0]);
    knowledge.content = c.facts;
    // Same deterministic fingerprint recipe as knowledge DB records, not a credential.
    knowledge.content_fingerprint = 'md5:' + createHash('md5').update(knowledge.content).digest('hex');
    data.records = { conversation_policy: { ...input.system_policy, id: input.system_policy.policy_version_id },
      event: { id: input.provider_message.event_id, conversation_id: input.provider_message.conversation_id,
        channel: 'whatsapp', payload: {details:{body:c.task}} }, knowledge: [knowledge] };
  } else if (c.profile === 'brand_guardian') {
    data.records.content = { id: f.input.content_id, generation: 1, draft_copy: c.task,
      media_url: c.scenario === 'missing_evidence' || c.scenario === 'reserve_uncertainty' ? 'synthetic-asset-reference' : null };
    for (const s of f.snapshot.sources.filter(s => s.kind === 'brand_rule')) putEvidence(s);
  } else {
    const missing = ['missing_evidence','reserve_uncertainty'].includes(c.scenario);
    task.options = { window_start: f.input.window_start, window_end: f.input.window_end,
      metric_codes: missing ? ['drafts','spend','revenue'] : ['drafts','leads','conversion_rate'] };
    putEvidence(source('metric', metric('drafts',3),10));
    if (!missing) {
      putEvidence(source('metric',metric('leads',10),11));
      putEvidence(source('metric',{...metric('conversion_rate', c.scenario === 'edge' ? 0 : 0.2),
        unit:'ratio',numerator:c.scenario === 'edge' ? 0 : 2,denominator:c.scenario === 'edge' ? 0 : 10},12));
    }
    if (c.scenario === 'authority') putEvidence(source('metric',metric('drafts',5),13));
  }
  return { task, data, clock: new Date(now).toISOString() };
}

export function prepareCase(c) {
  const bundle = bundleFor(c), prepared = prepareTask(bundle);
  const adapted = { request: prepared.request, deterministic_result: prepared.request ? null : prepared.execution };
  let baseline = { kind: 'human_reference_required', request: null, reference: null };
  if (bundle.data.profile.kind === 'existing_proposal') {
    // Same NEW integration wrapper/model/schema/inputs and budget for both arms;
    // isolates procedure augmentation, NOT a claim of equivalence to deployed v2.
    const request = structuredClone(prepared.request);
    request.messages[0].content = skills.find(s => s.code === bundle.data.profile.skill_code).version.instructions;
    baseline = { kind: 'unaugmented_pinned_platform_skill', request };
    const withoutInstructions = r => ({...r,messages:r.messages.slice(1)});
    assert.deepEqual(withoutInstructions(request),withoutInstructions(prepared.request),'Unequal pair conditions');
    assert.notEqual(request.messages[0].content,prepared.request.messages[0].content);
  }
  return { case_id:c.id, profile:c.profile, language:c.language, partition:c.partition,
    scenario:c.scenario, input_hash:fingerprint(bundle), baseline, adapted,
    reference_criteria:c.review_criterion, model_executed:false, quality_certified:false };
}

export function validateCorpus(value = corpus) {
  assert.equal(value.customer_approved,false); assert.equal(value.true_blind_holdout_available,false);
  assert.equal(value.cases.length,72); assert.equal(new Set(value.cases.map(c=>c.id)).size,72,'Duplicate cases');
  for (const profile of bindings.profiles) for (const language of ['en','ar']) {
    const cases = value.cases.filter(c=>c.profile === profile.code && c.language === language);
    assert.equal(cases.length,6); assert.equal(cases.filter(c=>c.partition === 'development').length,4);
    assert.deepEqual(cases.map(c=>c.scenario).sort(),['authority','edge','grounded','missing_evidence','reserve_locale','reserve_uncertainty']);
    for (const c of cases) {
      assert.equal(c.id,`${c.profile}.${c.language}.${c.scenario}`);
      assert.equal(c.provenance,'authored_synthetic_no_customer_data');
      assert.equal(c.partition,c.scenario.startsWith('reserve_') ? 'public_reserve_not_blind_holdout' : 'development');
      assert(c.task.length > 20 && c.facts.length > 40 && c.review_criterion.length > 20);
      if (language === 'ar') assert(/[\u0600-\u06ff]/u.test(c.task),'Missing Arabic scenario');
    }
    assert.equal(new Set(cases.map(c=>c.task)).size,6,'Repeated case text');
  }
}

// Structural screen only. A compiler pass in an isolated matching vLLM/xgrammar
// build is STILL mandatory; this function cannot guarantee compiler compatibility.
export function screenGuidedSchema(value) {
  assert(value && typeof value === 'object');
  const visit = schema => {
    if (Array.isArray(schema)) { schema.forEach(visit); return; }
    if (!schema || typeof schema !== 'object') return;
    assert(!Object.hasOwn(schema,'minProperties'),'Unreviewed minProperties');
    if (schema.type === 'object') {
      assert(schema.properties && Object.keys(schema.properties).length,'Unbounded object schema');
      assert.equal(schema.additionalProperties,false,'Open object schema');
      for (const key of schema.required ?? []) assert(Object.hasOwn(schema.properties,key),'Unknown required property');
    }
    Object.values(schema).forEach(visit);
  }; visit(value); return true;
}

export function preparePacket() {
  validateAgencyRuntime(); validateCorpus();
  assert.equal(rubric.status,'proposed_not_approved');
  assert.equal(rubric.repetitions,3);
  const cases = corpus.cases.map(prepareCase), schemas = new Set();
  for (const c of cases) for (const r of [c.baseline.request,c.adapted.request].filter(Boolean)) {
    assert.equal(r.model,modelPlaceholder);
    assert(r.max_tokens > 0 && r.max_tokens <= 8000); assert.equal(r.temperature,0.1);
    screenGuidedSchema(r.response_format.json_schema.schema);
    schemas.add(fingerprint(r.response_format.json_schema.schema));
  }
  const arms = cases.flatMap(c=>[['baseline',c.baseline],['adapted',c.adapted]].filter(([,a])=>a.request)
    .flatMap(([arm,a])=>Array.from({length:rubric.repetitions},(_,i)=>({case_id:c.case_id,profile:c.profile,language:c.language,
      arm,repetition:i+1,request_hash:fingerprint(a.request),status:'NOT_RUN',output_hash:null,
      latency_ms:null,prompt_tokens:null,completion_tokens:null,peak_memory_bytes:null,
      cost:null,review_scores:null,hard_failures:null}))));
  return {version:'agency.quality-preparation.v1',scope:'OFFLINE_PREPARATION_ONLY',source_baseline:sourceBaseline,
    source_lock_hash:fingerprint(lockManifest()),corpus_hash:fingerprint(corpus),rubric_hash:fingerprint(rubric),
    summary:{cases:cases.length,development_cases:48,public_reserve_cases:24,true_blind_holdout_cases:0,
      english_cases:36,arabic_cases:36,unique_guided_schemas:schemas.size,
      planned_model_attempts:arms.length,planned_deterministic_attempts:36,
      actual_model_calls:0,provider_calls:0,database_writes:0,quality_certified:false,execution_ready:false},
    blockers:['Customer/domain rubric and budget acceptance','Two bilingual reviewers and blind label escrow',
      'Private held-out corpus and reference answers frozen before outputs',
      'Exact model weights/tokenizer revision and isolated runtime/compiler image digests',
      'Isolated schema compilation and bounded probe approval','Authenticated runtime evaluation runner and gate evidence'],
    cases,planned_attempts:arms};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length <= 1 && (!args.length || ['--packet','--lock'].includes(args[0])), 'Offline flags only; no live execution supported');
  if (args[0] === '--lock') console.log(JSON.stringify(lockManifest(),null,2));
  else { verifyLock(); const packet = preparePacket(); console.log(JSON.stringify(args[0] === '--packet' ? packet : { ...packet.summary,blockers:packet.blockers },null,2)); }
}
