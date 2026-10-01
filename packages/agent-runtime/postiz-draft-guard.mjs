// Defense in depth for the Postiz gateway: only a single-post draft may leave Tanaghom.
const allowedKeys = new Set(['type', 'date', 'shortLink', 'tags', 'posts']);
export function assertPostizDraftOnly(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('postiz_draft_body_invalid');
  if (body.type !== 'draft') throw new Error('postiz_publish_type_forbidden');
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) throw new Error('postiz_draft_field_forbidden');
  if (body.shortLink !== undefined && body.shortLink !== false) throw new Error('postiz_draft_field_forbidden');
  if (!Array.isArray(body.posts) || body.posts.length !== 1) throw new Error('postiz_draft_single_post_required');
  const [post] = body.posts;
  if (!post || typeof post !== 'object' || typeof post.integration?.id !== 'string' || !post.integration.id) {
    throw new Error('postiz_draft_channel_required');
  }
  return body;
}

// Classifies read-only staging evidence for one approved content item (scorecard gate #45).
export function evaluatePostizStagingEvidence(snapshot) {
  const checks = [
    ['human_approval_recorded', snapshot.approvals_approved >= 1],
    ['exactly_one_provider_draft', snapshot.postiz_posts_total === 1 && snapshot.postiz_posts_draft === 1],
    ['no_publication_or_schedule', snapshot.postiz_posts_published === 0],
    ['exactly_one_external_operation', snapshot.operations_total === 1 && snapshot.operations_succeeded === 1],
    ['replay_created_no_duplicate_job', snapshot.draft_jobs_total === 1],
    ['no_indeterminate_postiz_operation', snapshot.operations_indeterminate === 0],
    ['postiz_emergency_stop_restored', snapshot.postiz_emergency_stop === true],
  ].map(([name, passed]) => ({ name, passed: Boolean(passed) }));
  return { passed: checks.every((check) => check.passed), checks };
}
