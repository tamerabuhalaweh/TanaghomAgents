// Fictional fixture bootstrap only, on a freshly owned isolated database.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {corpus,bundleFor} from '../../scripts/agency-quality-preparation.mjs';
import {fingerprint} from '../../packages/agent-runtime/agency-pilot.mjs';
import {policy,organizationId,ownerId,codes} from '../../tests/fixtures/agency-database.mjs';
import {existingFixture} from '../../tests/fixtures/agency-pilot.mjs';
import {modelName} from './runtime.mjs';
export {organizationId,ownerId,codes};
export async function seedQuality(pool){
  assert(/^tanaghom_quality_[a-f0-9]{12}$/.test((await pool.query('SELECT current_database() AS db')).rows[0].db));
  for(const language of ['en','ar']){
    const facts=corpus.cases.find(c=>c.language===language).facts;
    const k=(await pool.query('SELECT * FROM tanaghom.create_sales_knowledge_draft($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [`quality_${language}`,'Fictional Namaa Skills','offer',language,facts,'[]','customer_entry','Original synthetic evaluation facts',ownerId])).rows[0];
    for(const action of ['review','approve','activate'])await pool.query('SELECT * FROM tanaghom.transition_sales_knowledge_version($1,$2,$3,NULL)',[k.version_id,action,ownerId]);
  }
  const versions={};
  for(const code of codes){
    const skill=code==='social_media_strategist'?'001':['discovery_coach','support_responder'].includes(code)?'006':'002';
    const payload={code:`quality_${code}`,template_code:'campaign_planning',display_name:`Quality ${code}`,
      description:'Disposable quality simulation fixture.',objective:'Compare bounded fictional proposals.',responsibility:'No external actions.',tone:'Clear and helpful',brand_profile_key:null,
      languages:['en','ar'],knowledge_keys:['knowledge/quality_en/v1','knowledge/quality_ar/v1'],
      skills:[{skill_source:'platform',skill_version_id:`72000000-0000-4000-8000-000000000${skill}`,operating_mode:'shadow',approval_required:true,constraints:{}}],
      integrations:[],policy:{...policy,max_steps:1,max_tool_calls:1,max_retries:0,max_concurrency:1,max_tokens:8000}};
    const id=(await pool.query('SELECT * FROM tanaghom.create_organization_agent_draft($1,$2,$3,$4,NULL)',[organizationId,ownerId,payload,fingerprint(payload)])).rows[0].agent_version_id;
    await pool.query("SELECT * FROM tanaghom.transition_organization_agent_version($1,$2,$3,'validate',$4)",[organizationId,ownerId,id,{valid:true,validator_version:'quality-disposable.v1',runtime_certified:false}]);
    versions[code]=id;
  }
  const modelId=randomUUID();
  await pool.query(`INSERT INTO tanaghom.agent_runtime_profiles(id,code,model_name,planner_contract_version,planner_schema_ref,planner_schema_hash,prompt_version,prompt_hash,parser_version,lifecycle_state)
    SELECT $1,'quality_simulated_v1',$2,planner_contract_version,planner_schema_ref,planner_schema_hash,prompt_version,prompt_hash,parser_version,'validated'
    FROM tanaghom.agent_runtime_profiles WHERE id='7d000000-0000-4000-8000-000000000002'`,[modelId,modelName]);
  const connection=(await pool.query(`INSERT INTO tanaghom.integration_connections(organization_id,provider,status,base_url,credential_kind,configured_by,disconnected_at)
    VALUES($1,'ghl','disconnected','https://provider.test','private_token',$2,now()) RETURNING id`,[organizationId,ownerId])).rows[0].id;
  await pool.query('UPDATE tanaghom.organization_crm_policies SET conversation_emergency_stop=false WHERE organization_id=$1',[organizationId]);
  return {versions,modelId,connection};
}
export async function importCase(pool,c,fixtures,admin){
  const b=bundleFor(c),r=b.data.records;
  let target=null;
  const campaign=async(record)=>{
    const id=randomUUID();
    await pool.query(`INSERT INTO tanaghom.campaigns(id,name,brief,product_type,target_audience,budget_target,revenue_target,currency,created_by,organization_id)
      VALUES($1,$2,$3,$4,$5,0,0,'USD',$6,$7)`,[id,record.name||c.id,record.brief||c.facts,'course',record.target_audience||{language:c.language},ownerId,organizationId]);
    return id;
  };
  if(r.campaign){
    target=await campaign(r.campaign);
    if(r.strategy){const s=r.strategy;await pool.query(`INSERT INTO tanaghom.campaign_strategies(id,campaign_id,version,positioning,key_messages,channels,posting_cadence,content_pillars,model_name,prompt_version)
      VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,'quality-fixture.v1')`,[randomUUID(),target,s.positioning,JSON.stringify(s.key_messages),JSON.stringify(s.channels),s.posting_cadence,JSON.stringify(s.content_pillars),modelName]);}
  }else if(r.content){
    target=randomUUID();const campaignId=await campaign({});
    const strategyId=randomUUID(),s=existingFixture('content_creator',c.language).input.strategy;
    await pool.query(`INSERT INTO tanaghom.campaign_strategies(id,campaign_id,version,positioning,key_messages,channels,posting_cadence,content_pillars,model_name,prompt_version)
      VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,'quality-fixture.v1')`,[strategyId,campaignId,s.positioning,JSON.stringify(s.key_messages),JSON.stringify(s.channels),s.posting_cadence,JSON.stringify(s.content_pillars),modelName]);
    await pool.query(`INSERT INTO tanaghom.content_items(id,campaign_id,strategy_id,channel,content_type,draft_copy,media_brief,media_url)
      VALUES($1,$2,$3,'instagram','post',$4,'Synthetic fixture',$5)`,[target,campaignId,strategyId,r.content.draft_copy,r.content.media_url?'https://assets.test/unresolved.png':null]);
  }else if(r.event){
    target=randomUUID();const conversation=`quality-${target}`,contact=`test-${target}`;
    await pool.query(`INSERT INTO tanaghom.ghl_inbound_events(id,correlation_id,organization_id,integration_connection_id,provider_event_id,provider_event_type,
      location_id,contact_id,conversation_id,channel,direction,occurred_at,contract_version,body_sha256,payload)
      VALUES($1,$2,$3,$4,$5,'InboundMessage','quality-location',$6,$7,'whatsapp','inbound',now(),'phase5.ghl-inbound-event.v1',$8,$9)`,
      [target,randomUUID(),organizationId,fixtures.connection,`quality-event-${target}`,contact,conversation,'1'.repeat(64),r.event.payload]);
    await pool.query(`INSERT INTO tanaghom.conversations(organization_id,provider_conversation_id,contact_id,language,last_event_at,last_activity_at)
      VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT DO NOTHING`,[organizationId,conversation,contact,c.language]);
    await pool.query(`INSERT INTO tanaghom.ghl_contact_channel_policies(organization_id,contact_id,channel,consent_status,evidence,changed_by)
      VALUES($1,$2,'whatsapp','opted_in','Fictional test consent',$3)`,[organizationId,contact,ownerId]);
  }
  const evidence=[];
  for(const e of b.data.evidence){
    const result=await admin({action:'approve_evidence',kind:e.kind,record:e.record,expires_at:new Date(Date.now()+86400000).toISOString()});
    assert.equal(result.status,200,JSON.stringify(result));evidence.push(result.body.id);
  }
  return {target_id:target,options:b.task.options,evidence_ids:evidence};
}

// Authored transport fixture, NOT a model or human reference scorer.
export function stubResponse(request){
  const input=JSON.parse(request.messages.at(-1).content);
  const language=input.provider_message?.language_hint||input.language||input.campaign?.target_audience?.language||'en';
  let output;
  if(input.contract_version==='phase3.strategist-job.v1')output=existingFixture('social_media_strategist',language).output;
  else if(input.contract_version==='phase3.content-producer-job.v1')output=existingFixture('content_creator',language).output;
  else if(input.provider_message){
    output=existingFixture('support_responder',language).output;output.model_name=request.model;
    output.citations=input.retrieved_knowledge.map(k=>({source_id:k.source_id,source_version_id:k.source_version_id,content_fingerprint:k.content_fingerprint}));
    output.proposed_reply=input.retrieved_knowledge[0].content;
    output.conversation_summary.input_event_ids=[input.provider_message.event_id];
    if(/refund|أعد المبلغ|reveal|اكشف/.test(input.provider_message.body)){
      const refund=/refund|أعد المبلغ/i.test(input.provider_message.body);
      output.intent=refund?'refund':'policy_exception';output.risk_categories=[refund?'refund':'prompt_injection'];
      output.answer_status='escalate';output.next_best_action='escalate_to_human';output.proposed_reply=null;
      output.escalation={required:true,category:refund?'refund':'prompt_injection',reason:language==='ar'?'يلزم تدخل بشري.':'Human review required.'};
    }
  }else output={language,findings:[],questions:[]};
  return {model:request.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:500,completion_tokens:200}};
}
