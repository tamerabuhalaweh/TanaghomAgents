import { randomUUID } from 'node:crypto';
import { fingerprint } from '../../packages/agent-runtime/agency-pilot.mjs';
import { existingFixture } from './agency-pilot.mjs';
export const organizationId = '10000000-0000-4000-8000-000000000001';
export const ownerId = '00000000-0000-4000-8000-000000000001';
export const campaignId = '20000000-0000-4000-8000-000000000001';
export const modelId = '7d000000-0000-4000-8000-000000000002';
export const codes = ['social_media_strategist','content_creator','brand_guardian','discovery_coach','support_responder','executive_summary'];
export const policy = { business_timezone: 'Asia/Amman', business_hours: [], allowed_channels: ['instagram','whatsapp'],
  consent_required: true, max_steps: 2, max_tool_calls: 2, max_retries: 2, max_concurrency: 2,
  max_runtime_seconds: 300, max_tokens: 8000, max_daily_actions: 0, max_actions_per_minute: 0,
  max_follow_ups_per_contact: 0, monthly_budget: 0, allowed_record_types: ['campaign','content','conversation','report'],
  allowed_action_types: ['proposal.create'], approval_actions: ['provider.external_write'], approval_roles: ['owner','reviewer'],
  approval_expiry_minutes: 60, parameter_bound_approval: true, escalation_conditions: ['Missing evidence requires human review.'] };
export async function seedPilot(pool) {
  const query = (q,p=[]) => pool.query(q,p);
  const versions = {};
  for (const language of ['en','ar']) {
    const text = language === 'ar' ? 'تتضمن الدورة دروسا عملية ودعما.' : 'The course includes practical lessons and support.';
    const k = (await query('SELECT * FROM tanaghom.create_sales_knowledge_draft($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [`pilot_knowledge_${language}`,'Pilot knowledge','offer',language,text,'[]','customer_entry','Disposable fixture',ownerId])).rows[0];
    for (const transition of ['review','approve','activate']) await query('SELECT * FROM tanaghom.transition_sales_knowledge_version($1,$2,$3,NULL)',[k.version_id,transition,ownerId]);
  }
  for (const code of codes) {
    const skill = code === 'social_media_strategist' ? '001' : ['discovery_coach','support_responder'].includes(code) ? '006' : '002';
    const payload = { code: `pilot_${code}`, template_code: 'campaign_planning', display_name: `Pilot ${code}`,
      description: 'Disposable bounded Agency pilot integration fixture.', objective: 'Prove authenticated proposal-only execution.',
      responsibility: 'Produce test proposals without external actions.', tone: 'Clear and helpful', brand_profile_key: null,
      languages: ['en','ar'], knowledge_keys: ['knowledge/pilot_knowledge_en/v1','knowledge/pilot_knowledge_ar/v1'],
      skills: [{ skill_source: 'platform', skill_version_id: `72000000-0000-4000-8000-000000000${skill}`,
        operating_mode: 'shadow', approval_required: true, constraints: {} }], integrations: [], policy };
    const made = await query('SELECT * FROM tanaghom.create_organization_agent_draft($1,$2,$3,$4,NULL)',
      [organizationId,ownerId,payload,fingerprint(payload)]);
    const id = made.rows[0].agent_version_id;
    await query("SELECT * FROM tanaghom.transition_organization_agent_version($1,$2,$3,'validate',$4)",
      [organizationId,ownerId,id,{ valid:true,validator_version:'agency-disposable.v1',runtime_certified:false }]);
    versions[code] = id;
  }
  const strategy = existingFixture('content_creator').input.strategy;
  const strategyId = randomUUID();
  await query(`INSERT INTO tanaghom.campaign_strategies(id,campaign_id,version,positioning,key_messages,channels,posting_cadence,content_pillars,model_name,prompt_version)
    VALUES($1,$2,1,$3,$4,$5,$6,$7,'disposable-stub','agency-disposable.v1')`, [strategyId,campaignId,strategy.positioning,JSON.stringify(strategy.key_messages),
    JSON.stringify(strategy.channels),strategy.posting_cadence,JSON.stringify(strategy.content_pillars)]);
  const contentId = randomUUID();
  await query(`INSERT INTO tanaghom.content_items(id,campaign_id,strategy_id,channel,content_type,draft_copy,media_brief)
    VALUES($1,$2,$3,'instagram','post','Test course. دورة تجريبية.','Disposable visual')`,[contentId,campaignId,strategyId]);
  const connectionId = (await query(`INSERT INTO tanaghom.integration_connections(organization_id,provider,status,base_url,credential_kind,configured_by,disconnected_at)
    VALUES($1,'ghl','disconnected','https://provider.test','private_token',$2,now()) RETURNING id`,[organizationId,ownerId])).rows[0].id;
  const events = {};
  for (const language of ['en','ar']) {
    const text = language === 'ar' ? 'تتضمن الدورة دروسا عملية ودعما.' : 'The course includes practical lessons and support.';
    const eventId=randomUUID(), conversation=`pilot-conversation-${language}`, contact=`pilot-contact-${language}`;
    await query(`INSERT INTO tanaghom.ghl_inbound_events(id,correlation_id,organization_id,integration_connection_id,provider_event_id,provider_event_type,
      location_id,contact_id,conversation_id,channel,direction,occurred_at,contract_version,body_sha256,payload)
      VALUES($1,$2,$3,$4,$5,'InboundMessage','pilot-location',$6,$7,'whatsapp','inbound',now(),'phase5.ghl-inbound-event.v1',$8,$9)`,
      [eventId,randomUUID(),organizationId,connectionId,`pilot-event-${language}`,contact,conversation,'1'.repeat(64),{details:{body:text}}]);
    await query(`INSERT INTO tanaghom.conversations(organization_id,provider_conversation_id,contact_id,language,last_event_at,last_activity_at)
      VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT DO NOTHING`,[organizationId,conversation,contact,language]);
    await query(`INSERT INTO tanaghom.ghl_contact_channel_policies(organization_id,contact_id,channel,consent_status,evidence,changed_by)
      VALUES($1,$2,'whatsapp','opted_in','Disposable consent fixture',$3)`,[organizationId,contact,ownerId]);
    events[language] = eventId;
  }
  await query("UPDATE tanaghom.organization_crm_policies SET conversation_emergency_stop=false WHERE organization_id=$1",[organizationId]);
  return { versions,contentId,events };
}
