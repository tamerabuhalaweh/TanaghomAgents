// Read-only evidence collector for Postiz staging acceptance (#45). Never calls Postiz or changes state.
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { evaluatePostizStagingEvidence } from '../packages/agent-runtime/postiz-draft-guard.mjs';

const { DATABASE_URL: databaseUrl, CONTENT_ITEM_ID: contentId, RELEASE_COMMIT: release, EVIDENCE_OWNER: owner } = process.env;
const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
if (!databaseUrl || !/^[0-9a-f-]{36}$/i.test(contentId || '') || !/^[0-9a-f]{40}$/.test(release || '') || !owner) {
  console.error('Required: DATABASE_URL (read-only role), CONTENT_ITEM_ID (uuid), RELEASE_COMMIT (40-char sha), EVIDENCE_OWNER.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let snapshot;
try {
  await client.query('BEGIN TRANSACTION READ ONLY');
  const { rows: [row] } = await client.query(`SELECT
      (SELECT count(*) FROM tanaghom.content_approvals WHERE content_item_id=$1 AND decision='approved')::int AS approvals_approved,
      (SELECT count(*) FROM tanaghom.posts WHERE content_item_id=$1 AND provider='postiz')::int AS postiz_posts_total,
      (SELECT count(*) FROM tanaghom.posts WHERE content_item_id=$1 AND provider='postiz' AND status='draft')::int AS postiz_posts_draft,
      (SELECT count(*) FROM tanaghom.posts WHERE content_item_id=$1 AND provider='postiz' AND status IN ('scheduled','live'))::int AS postiz_posts_published,
      (SELECT count(*) FROM tanaghom.external_operations WHERE idempotency_key='postiz-draft:'||$1::text)::int AS operations_total,
      (SELECT count(*) FROM tanaghom.external_operations WHERE idempotency_key='postiz-draft:'||$1::text AND status='succeeded')::int AS operations_succeeded,
      (SELECT count(*) FROM tanaghom.external_operations WHERE provider='postiz' AND status='indeterminate')::int AS operations_indeterminate,
      (SELECT count(*) FROM tanaghom.agent_jobs WHERE job_type='content.postiz.draft' AND input->>'content_item_id'=$1::text)::int AS draft_jobs_total,
      (SELECT coalesce(bool_and(emergency_stop),false) FROM tanaghom.postiz_automation_status) AS postiz_emergency_stop`, [contentId]);
  snapshot = row;
  await client.query('ROLLBACK');
} finally { await client.end(); }

const result = evaluatePostizStagingEvidence(snapshot);
const report = `# Postiz staging acceptance evidence (#45)

- Date (UTC): ${new Date().toISOString()}
- Release commit: \`${release}\`
- Database migration: recorded by the release preflight evidence for this release
- Owner: ${owner}
- Content item: \`${contentId}\`
- Result: **${result.passed ? 'PASS — gate evidence candidate' : 'FAIL — no scorecard credit'}**

| Check | Result |
| --- | --- |
${result.checks.map((check) => `| ${check.name} | ${check.passed ? 'pass' : 'FAIL'} |`).join('\n')}

Counts: ${JSON.stringify(snapshot)}

Also attach (secret-free): Postiz UI screenshot showing the item as a draft, the
mapped channel name, and the second n8n run showing zero provider requests.
Collected inside a READ ONLY transaction; no provider call was made.
`;
if (out) await writeFile(out, report); else console.log(report);
process.exit(result.passed ? 0 : 1);
