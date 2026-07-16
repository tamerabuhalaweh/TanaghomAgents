import "server-only";

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";

export type QualityRolloutStage = "baseline" | "shadow" | "assisted" | "pilot_1" | "pilot_5" | "pilot_20" | "pilot_50";

const stageOrder: QualityRolloutStage[] = ["baseline", "shadow", "assisted", "pilot_1", "pilot_5", "pilot_20", "pilot_50"];
const requiredCohort: Record<QualityRolloutStage, string> = {
  baseline: "human_baseline", shadow: "ai_shadow", assisted: "assisted",
  pilot_1: "bounded_autonomous", pilot_5: "bounded_autonomous",
  pilot_20: "bounded_autonomous", pilot_50: "bounded_autonomous",
};

interface PolicyRow {
  current_stage: QualityRolloutStage;
  minimum_sample_size: number;
  minimum_groundedness_percent: string;
  minimum_policy_compliance_percent: string;
  minimum_qualification_accuracy_percent: string;
  maximum_unsupported_claim_percent: string;
  maximum_complaint_percent: string;
  maximum_opt_out_percent: string;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
}

interface SnapshotRow {
  id: string; cohort: string; period_start: string; period_end: string; sample_size: number;
  average_response_seconds: string | null; coverage_percent: string | null;
  groundedness_percent: string | null; policy_compliance_percent: string | null;
  qualification_accuracy_percent: string | null; qualification_percent: string | null;
  booking_percent: string | null; won_percent: string | null; human_edit_percent: string | null;
  handoff_percent: string | null; opt_out_percent: string | null; complaint_percent: string | null;
  unsupported_claim_percent: string | null; version_attribution: Record<string, string>;
  limitations: string; source_reference: string; recorded_at: string;
}

export class QualityRolloutError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

function number(value: string | null) { return value === null ? null : Number(value); }
function snapshot(row: SnapshotRow) {
  return {
    ...row,
    average_response_seconds: number(row.average_response_seconds), coverage_percent: number(row.coverage_percent),
    groundedness_percent: number(row.groundedness_percent), policy_compliance_percent: number(row.policy_compliance_percent),
    qualification_accuracy_percent: number(row.qualification_accuracy_percent), qualification_percent: number(row.qualification_percent),
    booking_percent: number(row.booking_percent), won_percent: number(row.won_percent), human_edit_percent: number(row.human_edit_percent),
    handoff_percent: number(row.handoff_percent), opt_out_percent: number(row.opt_out_percent),
    complaint_percent: number(row.complaint_percent), unsupported_claim_percent: number(row.unsupported_claim_percent),
  };
}

function gate(policy: PolicyRow, snapshots: ReturnType<typeof snapshot>[]) {
  const currentIndex = stageOrder.indexOf(policy.current_stage);
  const nextStage = stageOrder[currentIndex + 1] || null;
  if (!nextStage) return { next_stage: null, ready: false, requirements: [{ key: "maximum_stage", label: "Maximum controlled stage reached", passed: true }] };
  const cohort = requiredCohort[policy.current_stage];
  const evidence = snapshots.find((item) => item.cohort === cohort
    && (policy.current_stage === "baseline" || new Date(item.recorded_at) > new Date(policy.changed_at))) || null;
  const requirements = [
    { key: "sample", label: `At least ${policy.minimum_sample_size} reviewed ${cohort.replaceAll("_", " ")} conversations`, passed: (evidence?.sample_size || 0) >= policy.minimum_sample_size },
  ];
  if (policy.current_stage !== "baseline") {
    requirements.push(
      { key: "groundedness", label: `Groundedness at least ${Number(policy.minimum_groundedness_percent)}%`, passed: (evidence?.groundedness_percent ?? -1) >= Number(policy.minimum_groundedness_percent) },
      { key: "policy", label: `Policy compliance at least ${Number(policy.minimum_policy_compliance_percent)}%`, passed: (evidence?.policy_compliance_percent ?? -1) >= Number(policy.minimum_policy_compliance_percent) },
      { key: "qualification", label: `Qualification accuracy at least ${Number(policy.minimum_qualification_accuracy_percent)}%`, passed: (evidence?.qualification_accuracy_percent ?? -1) >= Number(policy.minimum_qualification_accuracy_percent) },
      { key: "claims", label: `Unsupported claims at most ${Number(policy.maximum_unsupported_claim_percent)}%`, passed: (evidence?.unsupported_claim_percent ?? 101) <= Number(policy.maximum_unsupported_claim_percent) },
      { key: "complaints", label: `Complaints at most ${Number(policy.maximum_complaint_percent)}%`, passed: (evidence?.complaint_percent ?? 101) <= Number(policy.maximum_complaint_percent) },
      { key: "opt_out", label: `Opt-outs at most ${Number(policy.maximum_opt_out_percent)}%`, passed: (evidence?.opt_out_percent ?? 101) <= Number(policy.maximum_opt_out_percent) },
    );
  }
  return { next_stage: nextStage, ready: requirements.every((item) => item.passed), requirements, evidence_snapshot_id: evidence?.id || null };
}

export async function getQualityRollout(request: NextRequest) {
  const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
  const [policyResult, snapshotResult, decisionsResult] = await Promise.all([
    database().query<PolicyRow>(
      `SELECT policy.*,actor.display_name AS changed_by_name
         FROM tanaghom.quality_rollout_policies policy
         LEFT JOIN tanaghom.app_users actor ON actor.id=policy.changed_by
        WHERE policy.organization_id=$1`, [user.organizationId]),
    database().query<SnapshotRow>(
      `SELECT DISTINCT ON (cohort) id,cohort,period_start,period_end,sample_size,
              average_response_seconds,coverage_percent,groundedness_percent,policy_compliance_percent,
              qualification_accuracy_percent,qualification_percent,booking_percent,won_percent,
              human_edit_percent,handoff_percent,opt_out_percent,complaint_percent,unsupported_claim_percent,
              version_attribution,limitations,source_reference,recorded_at
         FROM tanaghom.quality_evaluation_snapshots
        WHERE organization_id=$1 ORDER BY cohort,period_end DESC,id DESC`, [user.organizationId]),
    database().query(
      `SELECT decision.id,decision.decision,decision.from_stage,decision.to_stage,decision.rationale,
              decision.evidence_snapshot_ids,decision.decided_at,actor.display_name AS decided_by_name
         FROM tanaghom.quality_rollout_decisions decision
         JOIN tanaghom.app_users actor ON actor.id=decision.decided_by
        WHERE decision.organization_id=$1 ORDER BY decision.decided_at DESC LIMIT 20`, [user.organizationId]),
  ]);
  const policy = policyResult.rows[0];
  if (!policy) throw new QualityRolloutError("quality_rollout_not_found", 503);
  const snapshots = snapshotResult.rows.map(snapshot);
  return {
    observed_at: new Date().toISOString(),
    viewer: { role: user.role, can_promote: user.role === "owner" },
    policy: {
      current_stage: policy.current_stage, minimum_sample_size: policy.minimum_sample_size,
      minimum_groundedness_percent: Number(policy.minimum_groundedness_percent),
      minimum_policy_compliance_percent: Number(policy.minimum_policy_compliance_percent),
      minimum_qualification_accuracy_percent: Number(policy.minimum_qualification_accuracy_percent),
      maximum_unsupported_claim_percent: Number(policy.maximum_unsupported_claim_percent),
      maximum_complaint_percent: Number(policy.maximum_complaint_percent),
      maximum_opt_out_percent: Number(policy.maximum_opt_out_percent),
      changed_at: policy.changed_at,
      changed_by: policy.changed_by ? { id: policy.changed_by, display_name: policy.changed_by_name || "Tanaghom Admin" } : null,
    },
    promotion_gate: gate(policy, snapshots), snapshots, decisions: decisionsResult.rows,
  };
}

function mapDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/active owner/i.test(message)) return new QualityRolloutError("forbidden", 403);
  if (/sample gate/i.test(message)) return new QualityRolloutError("quality_sample_gate_failed", 409);
  if (/threshold gate/i.test(message)) return new QualityRolloutError("quality_threshold_gate_failed", 409);
  if (/sequentially/i.test(message)) return new QualityRolloutError("quality_stage_sequence_invalid", 409);
  if (/rationale|invalid quality rollout stage/i.test(message)) return new QualityRolloutError("quality_request_invalid", 400);
  return error;
}

export async function updateQualityRollout(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  let body: { target_stage?: unknown; rationale?: unknown };
  try { body = await request.json() as typeof body; }
  catch { throw new QualityRolloutError("invalid_json", 400); }
  if (!stageOrder.includes(body.target_stage as QualityRolloutStage)
      || typeof body.rationale !== "string" || body.rationale.trim().length < 3 || body.rationale.trim().length > 1000) {
    throw new QualityRolloutError("quality_request_invalid", 400);
  }
  try {
    await database().query("SELECT tanaghom.set_quality_rollout_stage($1,$2,$3,$4)",
      [owner.id, body.target_stage, body.rationale.trim(), randomUUID()]);
  } catch (error) { throw mapDatabaseError(error); }
  return getQualityRollout(request);
}
