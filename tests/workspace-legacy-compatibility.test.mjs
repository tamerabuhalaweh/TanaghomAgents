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
  assert.match(migration,/workspace queued model is unavailable to worker/);
  assert.match(migration,/REVOKE ALL ON FUNCTION tanaghom\.claim_agency_workspace_task_for_models\(uuid\[\]\) FROM PUBLIC/);
  assert.match(readFileSync('deployment/dashboard-demo/compose.yml','utf8'),/AGENCY_WORKSPACE_PROVIDER: gemini/);
  const server=readFileSync('apps/dashboard/lib/server/agency-workspace.ts','utf8');
  assert.match(server,/AGENCY_WORKSPACE_PROVIDER\|\|"gemma"/);
  assert.match(server,/isGemma\?legacy\.workspaceArtifact/);
  assert.match(server,/claim_agency_workspace_task_for_models\(\$1::uuid\[\]\)/);
});
