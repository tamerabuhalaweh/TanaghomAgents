import { readFileSync } from 'node:fs';
import { fingerprint } from '../../packages/agent-runtime/agency-pilot.mjs';

const skills = JSON.parse(readFileSync(new URL('../../config/skill-registry.v1.json', import.meta.url))).skills;
export const id = n => `a6000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const now = Date.parse('2026-09-06T13:00:00Z');
export const observed = '2026-09-06T12:00:00Z';
export const expires = '2026-09-07T12:00:00Z';
export const windowStart = '2026-09-01T00:00:00Z';
export const windowEnd = '2026-09-06T00:00:00Z';
export const source = (kind, record, n = 10) => ({ id: id(n), version_id: id(n + 100),
  organization_id: id(1), kind, record, content_hash: fingerprint(record), approved: true,
  approved_at: observed, expires_at: expires });
export const snapshot = (input, language = 'en', sources = []) => ({
  contract_version: 'phase7.agency-evidence-snapshot.v1', organization_id: id(1), run_id: id(2),
  job_id: id(3), correlation_id: id(4), mode: 'simulation', language, model_name: 'simulated-gemma',
  provider_execution_allowed: false, emergency_stop: false, consent_verified: true, dnd: false,
  human_takeover: false, allowed_channels: ['instagram', 'whatsapp'], event_ids: [id(5)],
  input_hash: fingerprint(input), observed_at: observed, expires_at: expires, sources });

export function existingFixture(code, language = 'en') {
  const skillCode = { social_media_strategist: 'create_campaign_strategy', content_creator: 'generate_content_drafts',
    discovery_coach: 'propose_conversation_reply', support_responder: 'propose_conversation_reply' }[code];
  const skill = skills.find(s => s.code === skillCode);
  const words = language === 'ar' ? ['دورة تجريبية', 'تعلّم مهارة جديدة', 'دروس عملية', 'مجموعة صغيرة']
    : ['Test course', 'Learn a new skill', 'Practical lessons', 'Small group'];
  const campaign = { id: id(20), name: words[0], brief: words[1], product_type: 'course', target_audience: {} };
  const strategy = { id: id(21), version: 1, positioning: words[1], key_messages: words.slice(1),
    channels: ['instagram'], posting_cadence: { instagram: { posts_per_week: 2 } },
    content_pillars: ['Learning', 'Practice', 'Support', 'Discovery'].map(name => ({ name,
      description: words[2], example_angles: [words[3]] })) };
  let input, output, sources;
  if (code === 'social_media_strategist') {
    input = { contract_version: 'phase3.strategist-job.v1', job_id: id(3), correlation_id: id(4),
      campaign: { ...campaign, currency: 'USD', budget_target: 0 } };
    sources = [source('campaign', input.campaign)];
    const { id: unusedId, version: unusedVersion, ...body } = strategy;
    output = { contract_version: 'phase3.strategist-output.v1', status: 'ok', ...body };
  } else if (code === 'content_creator') {
    input = { contract_version: 'phase3.content-producer-job.v1', job_id: id(3), correlation_id: id(4),
      campaign, strategy, max_items: 2 };
    sources = [source('campaign', campaign), source('strategy', strategy, 11)];
    output = { contract_version: 'phase3.content-producer-output.v1', items: [{ channel: 'instagram',
      content_type: 'post', content_pillar: 'Learning', draft_copy: words[1], media_brief: words[2],
      scheduled_time_suggestion: null }] };
  } else {
    const knowledge = { source_id: id(10), source_version_id: id(110), source_key: 'offer/test-course',
      title: words[0], category: 'offer', version: 1, language, content: words[1], structured_facts: [],
      content_fingerprint: 'md5:11111111111111111111111111111111', provenance_type: 'synthetic', provenance_ref: null };
    input = { contract_version: 'phase5.conversation-intelligence-request.v1',
      prompt_version: 'phase5.conversation-intelligence.prompt.v1',
      summary_prompt_version: 'phase5.conversation-summary.prompt.v1',
      output_contract: 'phase5.conversation-intelligence-output.v1',
      system_policy: { policy_version_id: id(22), confidence_threshold: 0.8, supported_languages: ['en', 'ar'],
        mandatory_escalations: ['refund'], forbidden_topics: [], forbidden_claims: [], sensitive_data_rules: [],
        dialect_guidance: {}, disclaimers: {}, external_actions_allowed: false },
      provider_message: { trust: 'untrusted_customer_input', event_id: id(5), conversation_id: 'synthetic-conversation',
        channel: 'whatsapp', language_hint: language, body: words[1] },
      retrieved_knowledge: [knowledge], conversation_context: { latest_summary: null, recent_turns: [], maximum_recent_turns: 12 },
      tool_results: [] };
    sources = [source('knowledge', knowledge), source('conversation_policy', input.system_policy, 11)];
    output = { contract_version: 'phase5.conversation-intelligence-output.v1',
      prompt_version: 'phase5.conversation-intelligence.prompt.v1', model_name: 'simulated-gemma', language,
      intent: 'product_question', urgency: 'normal', sentiment: 'neutral', sales_stage: 'discovery', risk_categories: ['none'],
      next_best_action: 'respond', confidence: 0.9, answer_status: 'proposal', proposed_reply: words[1],
      citations: [{ source_id: knowledge.source_id, source_version_id: knowledge.source_version_id,
        content_fingerprint: knowledge.content_fingerprint }], escalation: { required: false, category: null, reason: null },
      conversation_summary: { language, summary: words[1], input_event_ids: [id(5)] }, external_action_count: 0 };
  }
  const resolved = snapshot(input, language, sources);
  const claim = { invocation_id: id(6), run_id: id(2), job_id: id(3), organization_id: id(1),
    skill_version_id: skill.version.id, skill_code: skill.code, operation: skill.version.permission_manifest.operations[0],
    parameters: input, parameter_hash: fingerprint(input), idempotency_key: 'synthetic-pilot',
    executor_ref: skill.version.executor.ref, executor_version: skill.version.executor.version,
    instructions: skill.version.instructions };
  return { code, language, input, output, snapshot: resolved, claim };
}

export function brandFixture(language = 'en') {
  const phrase = language === 'ar' ? 'نتائج مضمونة' : 'guaranteed results';
  const content = { text: phrase, asset_ids: [id(31)] };
  const input = { contract_version: 'phase7.agency-brand-input.v1', organization_id: id(1),
    content_id: id(30), content_version: 1, ...content, content_hash: fingerprint(content) };
  const rule = { language, check: 'forbidden_phrase', phrase, category: 'claim', severity: 'high',
    correction: language === 'ar' ? 'استخدم الادعاء المعتمد فقط.' : 'Use only the approved claim.' };
  return { input, snapshot: snapshot(input, language, [source('content', input), source('brand_rule', rule, 11),
    source('asset_rights', { asset_id: id(31), allowed: true }, 12)]) };
}
export const metric = (metric_code = 'drafts', value = 3) => ({ metric_code, definition_version: 'agency.metrics.v1',
  window_start: windowStart, window_end: windowEnd, unit: 'count', value, currency: null, numerator: null, denominator: null });
export function reportFixture(language = 'en') {
  const input = { contract_version: 'phase7.agency-report-input.v1', organization_id: id(1),
    window_start: windowStart, window_end: windowEnd, metric_codes: ['drafts', 'leads', 'conversion_rate'] };
  return { input, snapshot: snapshot(input, language, [source('metric', metric(), 10),
    source('metric', metric('leads', 0), 11), source('metric', { ...metric('conversion_rate', 0),
      unit: 'ratio', numerator: 0, denominator: 0 }, 12)]) };
}
