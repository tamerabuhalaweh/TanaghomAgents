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
  const [policyResult, snapshotResult, decisionsResult, programResult, datasetResult] = await Promise.all([
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
    database().query(
      `SELECT id,version_number,status,formulas,thresholds,notes,created_at,approved_at
         FROM tanaghom.quality_metric_program_versions
        WHERE organization_id=$1 ORDER BY version_number DESC LIMIT 5`, [user.organizationId]),
    database().query(
      `SELECT dataset.id,dataset.source_label AS name,dataset.status,dataset.case_count,dataset.period_start,dataset.period_end,
              dataset.source_sha256 AS source_hash,dataset.pii_attested AS pii_removed_attested,dataset.imported_at,
              count(job.id)::integer AS job_count,
              count(job.id) FILTER (WHERE job.status='succeeded')::integer AS succeeded_jobs,
              count(job.id) FILTER (WHERE job.status='failed')::integer AS failed_jobs
         FROM tanaghom.quality_evaluation_datasets dataset
         LEFT JOIN tanaghom.quality_shadow_jobs job ON job.dataset_id=dataset.id
        WHERE dataset.organization_id=$1
        GROUP BY dataset.id ORDER BY dataset.imported_at DESC LIMIT 20`, [user.organizationId]),
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
    evidence_setup: { metric_programs: programResult.rows, datasets: datasetResult.rows },
  };
}

function mapDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/active owner/i.test(message)) return new QualityRolloutError("forbidden", 403);
  if (/sample gate/i.test(message)) return new QualityRolloutError("quality_sample_gate_failed", 409);
  if (/threshold gate/i.test(message)) return new QualityRolloutError("quality_threshold_gate_failed", 409);
  if (/sequentially/i.test(message)) return new QualityRolloutError("quality_stage_sequence_invalid", 409);
  if (/rationale|invalid quality rollout stage/i.test(message)) return new QualityRolloutError("quality_request_invalid", 400);
  if (/PII|de-identified|attestation|personal data/i.test(message)) return new QualityRolloutError("quality_import_contains_pii", 409);
  if (/metric program|formulas|thresholds/i.test(message)) return new QualityRolloutError("quality_metrics_required", 409);
  if (/shadow run is not authorized/i.test(message)) return new QualityRolloutError("quality_shadow_not_authorized", 409);
  return error;
}

const defaultFormulas = {
  response_time: "Average seconds from inbound message to first human reply",
  coverage: "Percent of reviewed cases with a human reply",
  groundedness: "Percent of AI proposals supported by approved knowledge",
  policy_compliance: "Percent of AI proposals passing approved policy review",
  qualification_accuracy: "Percent of AI labels matching the reviewed human qualification label",
  qualification: "Percent of reviewed cases marked qualified", booking: "Percent with a booked appointment",
  won: "Percent marked won during the measurement period", unsupported_claim: "Percent with an unsupported factual claim",
  complaint: "Percent marked as a complaint", opt_out: "Percent marked opted out",
};
const defaultThresholds = { minimum_sample_size: 25, minimum_groundedness_percent: 90,
  minimum_policy_compliance_percent: 95, minimum_qualification_accuracy_percent: 85,
  maximum_unsupported_claim_percent: 1, maximum_complaint_percent: 1, maximum_opt_out_percent: 5 };

export async function updateQualityEvidence(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { throw new QualityRolloutError("invalid_json", 400); }
  try {
    if (body.action === "approve_default_metrics") {
      const created = await database().query<{ id: string }>(
        "SELECT tanaghom.create_quality_metric_program($1,$2::jsonb,$3::jsonb,$4) AS id",
        [owner.id, defaultFormulas, defaultThresholds, "Tanaghom Phase 5G reviewed comparison formulas and conservative rollout thresholds."]);
      await database().query("SELECT tanaghom.approve_quality_metric_program($1,$2)", [owner.id, created.rows[0].id]);
    } else if (body.action === "import_baseline") {
      const dataset = body.dataset as Record<string, unknown> | null;
      if (!dataset || dataset.contract_version !== "phase5g.quality-baseline-import.v1" || !Array.isArray(dataset.cases)) throw new QualityRolloutError("quality_request_invalid", 400);
      await database().query(
        "SELECT tanaghom.import_quality_baseline_dataset($1,$2,$3,$4::timestamptz,$5::timestamptz,$6::jsonb,$7::jsonb,$8::boolean)",
        [owner.id,dataset.name,dataset.source_hash,dataset.period_start,dataset.period_end,dataset.versions,JSON.stringify(dataset.cases),dataset.pii_removed_attestation]);
    } else if (body.action === "record_baseline") {
      await database().query("SELECT tanaghom.record_quality_dataset_snapshot($1,$2::uuid,'human_baseline',$3,$4)",
        [owner.id,body.dataset_id,"Reviewed de-identified human baseline; outcomes are observational, not causal.","Tanaghom Quality dashboard import"]);
    } else if (body.action === "queue_shadow") {
      await database().query("SELECT tanaghom.queue_quality_shadow_run($1,$2::uuid,$3::jsonb)", [owner.id,body.dataset_id,
        { model: "gemma4-26b-a4b-canary", prompt: "quality-shadow-evaluator/v1", knowledge: "approved-current", policy: "manual-v1", campaign: "evaluation-only" }]);
    } else if (body.action === "record_shadow") {
      await database().query("SELECT tanaghom.record_quality_dataset_snapshot($1,$2::uuid,'ai_shadow',$3,$4)",
        [owner.id,body.dataset_id,"Proposal-only AI shadow results; no message was sent and no provider action occurred.","Tanaghom Quality shadow evaluator"]);
    } else throw new QualityRolloutError("quality_request_invalid", 400);
  } catch (error) { if (error instanceof QualityRolloutError) throw error; throw mapDatabaseError(error); }
  return getQualityRollout(request);
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
