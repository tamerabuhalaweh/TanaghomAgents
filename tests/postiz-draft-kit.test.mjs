import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertPostizDraftOnly, evaluatePostizStagingEvidence } from '../packages/agent-runtime/postiz-draft-guard.mjs';

const draft = () => ({ type: 'draft', date: '2026-09-06T00:00:00.000Z', shortLink: false, tags: [],
  posts: [{ integration: { id: 'channel-1' }, value: [{ content: 'Draft', image: [] }], settings: { __type: 'instagram' } }] });

test('gateway guard accepts exactly the single-post draft shape built by prepare_postiz_draft', () => {
  assert.deepEqual(assertPostizDraftOnly(draft()), draft());
});

test('gateway guard rejects publish, schedule and widened requests before any provider call', () => {
  for (const type of ['now', 'schedule', undefined, 'DRAFT']) {
    assert.throws(() => assertPostizDraftOnly({ ...draft(), type }), /postiz_publish_type_forbidden/);
  }
  assert.throws(() => assertPostizDraftOnly({ ...draft(), posts: [...draft().posts, ...draft().posts] }), /single_post_required/);
  assert.throws(() => assertPostizDraftOnly({ ...draft(), posts: [] }), /single_post_required/);
  assert.throws(() => assertPostizDraftOnly({ ...draft(), shortLink: true }), /field_forbidden/);
  assert.throws(() => assertPostizDraftOnly({ ...draft(), publishNow: true }), /field_forbidden/);
  assert.throws(() => assertPostizDraftOnly({ ...draft(), posts: [{ value: [] }] }), /channel_required/);
  for (const body of [null, [], 'draft']) assert.throws(() => assertPostizDraftOnly(body), /body_invalid/);
});

test('draft gateway route enforces the guard before the database transaction and provider dispatch', () => {
  const route = readFileSync('apps/dashboard/app/api/internal/integrations/postiz/draft/route.ts', 'utf8');
  const guard = route.indexOf('assertPostizDraftOnly(body.request_body)');
  assert.ok(guard > 0);
  assert.ok(guard < route.indexOf('database().connect()'));
  assert.ok(guard < route.indexOf('createPostizDraft('));
});

const passing = { approvals_approved: 1, postiz_posts_total: 1, postiz_posts_draft: 1, postiz_posts_published: 0,
  operations_total: 1, operations_succeeded: 1, operations_indeterminate: 0, draft_jobs_total: 1, postiz_emergency_stop: true };

test('staging evidence passes only for one approved draft, one operation, no publication and a restored stop', () => {
  assert.equal(evaluatePostizStagingEvidence(passing).passed, true);
  for (const [field, value] of [['approvals_approved', 0], ['postiz_posts_total', 2], ['postiz_posts_draft', 0],
    ['postiz_posts_published', 1], ['operations_total', 2], ['operations_succeeded', 0],
    ['operations_indeterminate', 1], ['draft_jobs_total', 2], ['postiz_emergency_stop', false]]) {
    const result = evaluatePostizStagingEvidence({ ...passing, [field]: value });
    assert.equal(result.passed, false, field);
  }
});

test('staging evidence collector is read-only and the runbook keeps every stop in place', () => {
  const script = readFileSync('scripts/postiz-staging-evidence.mjs', 'utf8');
  assert.match(script, /BEGIN TRANSACTION READ ONLY/);
  assert.doesNotMatch(script, /\b(INSERT|UPDATE|DELETE|ALTER|fetch\()/);
  const runbook = readFileSync('deployment/postiz-staging-acceptance/RUNBOOK.md', 'utf8');
  for (const rule of [/never `now` or `schedule`/i, /emergency stop/i, /schedule trigger stays disabled/i, /rollback/i]) assert.match(runbook, rule);
});
