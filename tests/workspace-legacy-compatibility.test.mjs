import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as legacy from '../packages/agent-runtime/workspace-gemma.mjs';

test('Gemma workspace preserves the prior procedure and request contract', () => {
  assert.equal(legacy.workspaceHash, '3a3804be2a664e8ce0aa4fefc8bf7c6cf789c836e0c5939a3a7a41039414134d');
  const task = {profile:'content_creator',language:'en',model:'gemma4-26b-a4b-canary',title:'Fixture',brief:'A fictional campaign',source_facts:'Only fictional facts are supplied.',shared_context:[],context_hash:'fixture'};
  const request = legacy.workspaceRequest(task,32768);
  assert.equal(request.model,task.model);
  assert.equal(request.stream,false);
  const artifact=legacy.workspaceArtifact(task,{model:task.model,choices:[{finish_reason:'stop',message:{content:'A sufficiently long fictional draft.'}}]},10);
  assert.equal(artifact.procedure_hash,legacy.workspaceHash);
  assert.equal(artifact.external_actions,0);
  assert.equal(artifact.human_approved,false);
});

test('both workspace profiles remain allowed and demo explicitly selects Gemini', () => {
  const migration=readFileSync('packages/database/migrations/0048_gemini_workspace_model.up.sql','utf8');
  assert.match(migration,/id IN\s*\(\s*'7d000000-0000-4000-8000-000000000002','7d000000-0000-4000-8000-000000000003'/);
  assert.match(migration,/claim_agency_workspace_task_for_models/);
  assert.doesNotMatch(migration,/workspace queued model is unavailable to worker/);
  assert.match(migration,/a\.model_profile_id=ANY\(p_models\)/);
  assert.match(migration,/REVOKE ALL ON FUNCTION tanaghom\.claim_agency_workspace_task_for_models\(uuid\[\]\) FROM PUBLIC/);
  assert.match(readFileSync('deployment/dashboard-demo/compose.yml','utf8'),/AGENCY_WORKSPACE_PROVIDER: gemini/);
  const server=readFileSync('apps/dashboard/lib/server/agency-workspace.ts','utf8');
  assert.match(server,/AGENCY_WORKSPACE_PROVIDER\|\|"gemma"/);
  assert.match(server,/isGemma\?legacy\.workspaceArtifact/);
  assert.match(server,/claim_agency_workspace_task_for_models\(\$1::uuid\[\]\)/);
});

test('0048 downgrade refuses while any workspace or step references the Gemini profile', () => {
  const down=readFileSync('packages/database/migrations/0048_gemini_workspace_model.down.sql','utf8');
  assert.match(down,/agency_pilot_tasks WHERE model_profile_id='7d000000-0000-4000-8000-000000000003'/);
  assert.match(down,/agency_workspace_steps s JOIN tanaghom\.agency_pilot_tasks t/);
  assert.match(down,/agency_workspaces w JOIN tanaghom\.agency_workspace_steps s/);
});

test('demo control transaction requires the reviewed baseline, not an exact row count', () => {
  const sql=readFileSync('deployment/dashboard-demo/sql/workspace-control.sql','utf8');
  assert.match(sql,/version='0048_gemini_workspace_model'/);
  assert.match(sql,/Postiz may stay connected/);
  const control=readFileSync('deployment/dashboard-demo/scripts/workspace-control.sh','utf8');
  assert.match(control,/TANAGHOM_DEMO_ALLOWED_PROJECTS/);
  assert.match(control,/grep -vxF "\$\{allow\[@\]\}"/);
  assert.doesNotMatch(sql,/count\(\*\) FROM public\.schema_migrations\) <> 45/);
  assert.match(readFileSync('deployment/dashboard-demo/scripts/workspace-control.sh','utf8'),/APPROVED-ISOLATED-DEMO-CONTROL/);
});
