// Authenticated transport adapter. Only SECURITY DEFINER resolver bundles enter
// this module; HTTP clients supply record IDs, never snapshots or instructions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { fingerprint, prepareAgencyInvocation, validateAgencyResult, prepareBrandReview,
  validateBrandReview, buildExecutiveReport } from './agency-pilot.mjs';

const root = new URL('../../', import.meta.url);
const json = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const registry = json('config/skill-registry.v1.json').skills;
const profiles = json('config/agency-runtime-bindings.v1.json').profiles;
const ajv = new Ajv2020({ strict: false, allErrors: false }); addFormats(ajv);
const uuid = { type: 'string', format: 'uuid' };
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const command = ajv.compile({ oneOf: [
  object({ action: { const: 'bind' }, agent_version_id: uuid, profile_code: { enum: profiles.map(p => p.code) } }),
  object({ action: { const: 'approve_evidence' }, kind: { enum: ['brand_rule','asset_rights','metric'] },
    record: { type: 'object' }, expires_at: { type: 'string', format: 'date-time' } }),
  object({ action: { const: 'revoke_evidence' }, evidence_id: uuid }),
  object({ action: { const: 'queue' }, binding_id: uuid, model_profile_id: uuid, language: { enum: ['en','ar'] },
    target_id: { anyOf: [uuid, { type: 'null' }] }, options: { type: 'object' },
    evidence_ids: { type: 'array', maxItems: 30, uniqueItems: true, items: uuid },
    idempotency_key: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$' } }),
] });
const evidence = Object.fromEntries(['brand_rule','asset_rights','metric'].map(kind => [kind,
  ajv.compile(json(`packages/contracts/schemas/phase7/agency-${kind === 'metric' ? 'metric-observation' : kind.replaceAll('_','-')}.v1.schema.json`))]));
const reportInput = ajv.compile(json('packages/contracts/schemas/phase7/agency-report-input.v1.schema.json'));
export function validateEvidence(kind, record) { assert(evidence[kind]?.(record), 'Invalid typed evidence'); }
export function validateCommand(body) {
  assert(command(body), 'Invalid pilot command');
  if (body.action === 'approve_evidence') validateEvidence(body.kind, body.record);
  if (body.action === 'queue' && Object.keys(body.options).length) {
    assert(reportInput({ ...body.options, organization_id: '00000000-0000-4000-8000-000000000001',
      contract_version: 'phase7.agency-report-input.v1' }), 'Invalid report options');
  }
  return body;
}
export const responseHash = fingerprint;
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
const guided = value => Array.isArray(value) ? value.map(guided)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .filter(([k]) => !['$schema','$id','format','uniqueItems','minProperties'].includes(k))
    .map(([k,v]) => [k, guided(v)])) : value;

function resolve(bundle) {
  const { task: t, data: d } = bundle, code = d.binding.profile_code;
  const profile = profiles.find(p => p.code === code);
  assert.deepEqual(d.profile, profile, 'Database/source binding drift');
  assert.equal(d.binding.organization_id, t.organization_id);
  assert.equal(d.agent.organization_id, t.organization_id);
  assert(d.agent.languages.includes(t.language) && ['validated','simulation'].includes(d.agent.lifecycle_state));
  assert(d.policy && d.policy.max_tokens > 0, 'Bounded agent policy required');
  const recordType = ['social_media_strategist','content_creator'].includes(code) ? 'campaign'
    : code === 'brand_guardian' ? 'content' : code === 'executive_summary' ? 'report' : 'conversation';
  assert(d.policy.allowed_record_types.includes(recordType) && d.policy.allowed_action_types.includes('proposal.create'), 'Policy does not allow this proposal');
  assert(d.policy.max_steps >= 1 && (code === 'executive_summary' || d.policy.max_tool_calls >= 1), 'Policy tool budget exhausted');
  if (profile.platform_skill_version_id) assert(d.assigned_skills.some(s =>
    s.platform_skill_version_id === profile.platform_skill_version_id && s.operating_mode !== 'disabled'), 'Skill revoked');
  const s = { contract_version: 'phase7.agency-evidence-snapshot.v1', organization_id: t.organization_id,
    run_id: t.id, job_id: t.id, correlation_id: t.correlation_id, mode: 'simulation', language: t.language,
    model_name: d.model.model_name, provider_execution_allowed: false, emergency_stop: false,
    consent_verified: true, dnd: false, human_takeover: false, allowed_channels: d.policy.allowed_channels,
    event_ids: [], observed_at: t.claimed_at, expires_at: t.lease_expires_at, sources: [] };
  const source = (kind, record, id, version = id, approved = t.created_at, expires = t.lease_expires_at) => {
    s.sources.push({ id, version_id: version, organization_id: t.organization_id, kind, record,
      approved: true, approved_at: approved, expires_at: expires, content_hash: fingerprint(record) });
  };
  for (const e of d.evidence) {
    assert.equal(e.organization_id, t.organization_id); validateEvidence(e.kind, e.record);
    source(e.kind, e.record, e.id, e.id, e.approved_at, e.expires_at);
  }
  let input;
  if (['social_media_strategist','content_creator'].includes(code)) {
    const campaign = pick(d.records.campaign, ['id','name','brief','product_type','target_audience']);
    if (code === 'social_media_strategist') Object.assign(campaign,
      pick(d.records.campaign, ['currency','budget_target','revenue_target']));
    input = { contract_version: code === 'social_media_strategist' ? 'phase3.strategist-job.v1' : 'phase3.content-producer-job.v1',
      job_id: t.id, correlation_id: t.correlation_id, campaign };
    source('campaign', campaign, campaign.id);
    if (code === 'content_creator') {
      assert(d.records.strategy, 'Current strategy required');
      input.strategy = pick(d.records.strategy, ['id','version','positioning','key_messages','channels','posting_cadence','content_pillars']);
      input.max_items = 2;
      source('strategy', input.strategy, input.strategy.id);
    }
  } else if (['discovery_coach','support_responder'].includes(code)) {
    const r = d.records, p = r.conversation_policy, e = r.event;
    const policy = { policy_version_id: p.id, ...pick(p, ['confidence_threshold','supported_languages','mandatory_escalations',
      'forbidden_topics','forbidden_claims','sensitive_data_rules','dialect_guidance','disclaimers']), external_actions_allowed: false };
    policy.confidence_threshold = Number(policy.confidence_threshold);
    input = { contract_version: 'phase5.conversation-intelligence-request.v1', prompt_version: 'phase5.conversation-intelligence.prompt.v1',
      summary_prompt_version: 'phase5.conversation-summary.prompt.v1', output_contract: 'phase5.conversation-intelligence-output.v1',
      system_policy: policy, provider_message: { trust: 'untrusted_customer_input', event_id: e.id,
        conversation_id: e.conversation_id, channel: e.channel, language_hint: t.language, body: e.payload.details.body },
      retrieved_knowledge: r.knowledge, conversation_context: { latest_summary: null, recent_turns: [], maximum_recent_turns: 12 }, tool_results: [] };
    s.event_ids = [e.id]; source('conversation_policy', policy, p.id);
    for (const k of r.knowledge) source('knowledge', k, k.source_id, k.source_version_id);
  } else if (code === 'brand_guardian') {
    const c = d.records.content;
    const content = { text: c.draft_copy, asset_ids: c.media_url ? [c.id] : [] };
    input = { contract_version: 'phase7.agency-brand-input.v1', organization_id: t.organization_id,
      content_id: c.id, content_version: c.generation, ...content, content_hash: fingerprint(content) };
    source('content', input, c.id);
  } else {
    input = { ...t.options, contract_version: 'phase7.agency-report-input.v1', organization_id: t.organization_id };
  }
  s.input_hash = fingerprint(input);
  return { code, profile, input, snapshot: s, now: Date.parse(bundle.clock) };
}

export function prepareTask(bundle) {
  const r = resolve(bundle), { task: t, data: d } = bundle;
  let execution, request = null;
  if (r.profile.kind === 'existing_proposal') {
    const skill = registry.find(s => s.code === r.profile.skill_code);
    execution = prepareAgencyInvocation(r.code, { invocation_id: t.id, run_id: t.id, job_id: t.id,
      organization_id: t.organization_id, skill_version_id: skill.version.id, skill_code: skill.code,
      operation: skill.version.permission_manifest.operations[0], parameters: r.input,
      parameter_hash: fingerprint(r.input), idempotency_key: t.idempotency_key,
      executor_ref: skill.version.executor.ref, executor_version: skill.version.executor.version,
      instructions: skill.version.instructions }, r.snapshot, r.now);
    request = { model: r.snapshot.model_name, temperature: 0.1, max_tokens: Math.min(d.policy.max_tokens, 8000),
      response_format: { type: 'json_schema', json_schema: { name: 'agency_pilot_output_v1', strict: true,
        schema: guided(json(r.profile.output_schema_ref)) } }, messages: [
        { role: 'system', content: execution.claim.instructions }, { role: 'user', content: JSON.stringify(r.input) }] };
  } else if (r.code === 'brand_guardian') {
    execution = prepareBrandReview(r.input, r.snapshot, r.now);
    request = execution.request; request.max_tokens = Math.min(d.policy.max_tokens, request.max_tokens);
  } else execution = buildExecutiveReport(r.input, r.snapshot, r.now);
  if (request) {
    // Conservative byte reservation for input plus framing; actual reported
    // prompt/completion usage is checked again before accepting any result.
    const allowance = d.policy.max_tokens - Buffer.byteLength(JSON.stringify(request.messages)) - 256;
    assert(allowance >= 32, 'Insufficient token budget for resolved context');
    request.max_tokens = Math.min(request.max_tokens, allowance);
  }
  assert(Buffer.byteLength(JSON.stringify(request)) <= 200000, 'Request context exceeds pilot limit');
  return { code: r.code, execution, request };
}

export function completeTask(bundle, response) {
  const r = resolve(bundle), stored = bundle.task.prepared;
  assert(stored && stored.code === r.code && bundle.task.basis_hash === bundle.basis_hash, 'Stale preparation');
  if (r.code === 'executive_summary') {
    assert.equal(response, null, 'Deterministic report takes no model response');
    const result = buildExecutiveReport(r.input, r.snapshot, r.now);
    assert.deepEqual(stored.execution, result);
    return result;
  }
  assert(response && response.model === r.snapshot.model_name, 'Unexpected model identity');
  assert(Array.isArray(response.choices) && response.choices.length === 1, 'One completion required');
  assert.equal(response.choices[0].finish_reason, 'stop', 'Incomplete model response');
  assert(Number.isSafeInteger(response.usage?.prompt_tokens) && response.usage.prompt_tokens >= 0
    && Number.isSafeInteger(response.usage?.completion_tokens) && response.usage.completion_tokens >= 0
    && response.usage.prompt_tokens + response.usage.completion_tokens <= bundle.data.policy.max_tokens, 'Token budget exceeded');
  const content = response.choices[0].message?.content;
  assert(typeof content === 'string' && Buffer.byteLength(content) <= 100000, 'Bounded JSON output required');
  assert(!response.choices[0].message.tool_calls?.length, 'Tool requests forbidden');
  const output = JSON.parse(content);
  return r.code === 'brand_guardian'
    ? validateBrandReview(stored.execution, output, r.input, r.snapshot, r.now)
    : validateAgencyResult(stored.execution, output, r.snapshot, r.now);
}
