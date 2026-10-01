export interface PostizStagingSnapshot {
  approvals_approved: number;
  postiz_posts_total: number;
  postiz_posts_draft: number;
  postiz_posts_published: number;
  operations_total: number;
  operations_succeeded: number;
  operations_indeterminate: number;
  draft_jobs_total: number;
  postiz_emergency_stop: boolean;
}
export function assertPostizDraftOnly<T>(body: T): T;
export function evaluatePostizStagingEvidence(snapshot: PostizStagingSnapshot): {
  passed: boolean;
  checks: { name: string; passed: boolean }[];
};
