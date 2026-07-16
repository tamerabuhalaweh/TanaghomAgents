"use client";

import {
  ArrowRight, CheckCircle2, CircleAlert, Clock3, FlaskConical,
  Database, Gauge, LockKeyhole, RefreshCw, RotateCcw, ShieldCheck, Upload, UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

type Stage = "baseline" | "shadow" | "assisted" | "pilot_1" | "pilot_5" | "pilot_20" | "pilot_50";
type Cohort = "human_baseline" | "ai_shadow" | "assisted" | "bounded_autonomous";
interface Snapshot {
  id: string; cohort: Cohort; period_start: string; period_end: string; sample_size: number;
  average_response_seconds: number | null; coverage_percent: number | null; groundedness_percent: number | null;
  policy_compliance_percent: number | null; qualification_accuracy_percent: number | null;
  qualification_percent: number | null; booking_percent: number | null; won_percent: number | null;
  human_edit_percent: number | null; handoff_percent: number | null; opt_out_percent: number | null;
  complaint_percent: number | null; unsupported_claim_percent: number | null;
  version_attribution: Record<string, string>; limitations: string; source_reference: string; recorded_at: string;
}
interface QualityData {
  observed_at: string;
  viewer: { role: string; can_promote: boolean };
  policy: { current_stage: Stage; minimum_sample_size: number; changed_at: string; changed_by: { display_name: string } | null };
  promotion_gate: { next_stage: Stage | null; ready: boolean; evidence_snapshot_id?: string | null; requirements: Array<{ key: string; label: string; passed: boolean }> };
  snapshots: Snapshot[];
  decisions: Array<{ id: string; decision: string; from_stage: Stage; to_stage: Stage; rationale: string; decided_at: string; decided_by_name: string }>;
  evidence_setup: {
    metric_programs: Array<{ id: string; version_number: number; status: string; notes: string; approved_at: string | null }>;
    datasets: Array<{ id: string; name: string; status: string; case_count: number; imported_at: string; job_count: number; succeeded_jobs: number; failed_jobs: number }>;
  };
}

const stages: Array<{ id: Stage; label: string; copy: string }> = [
  { id: "baseline", label: "Human baseline", copy: "Measure the current team honestly." },
  { id: "shadow", label: "Shadow", copy: "AI proposes; nobody sends." },
  { id: "assisted", label: "Assisted", copy: "Humans review, edit, and send." },
  { id: "pilot_1", label: "1% pilot", copy: "Low-risk intents only." },
  { id: "pilot_5", label: "5% pilot", copy: "Expand after reviewed evidence." },
  { id: "pilot_20", label: "20% pilot", copy: "Controlled campaign share." },
  { id: "pilot_50", label: "50% pilot", copy: "Owner-approved upper pilot." },
];
const cohorts: Array<{ id: Cohort; label: string; copy: string }> = [
  { id: "human_baseline", label: "Human baseline", copy: "Current team performance before AI comparison." },
  { id: "ai_shadow", label: "AI shadow", copy: "Proposals scored without customer delivery." },
  { id: "assisted", label: "Human + AI", copy: "Approved and edited AI assistance." },
  { id: "bounded_autonomous", label: "Controlled pilot", copy: "Approved low-risk autonomous handling." },
];
const stageName = Object.fromEntries(stages.map((stage) => [stage.id, stage.label])) as Record<Stage, string>;

function date(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function percent(value: number | null) { return value === null ? "—" : `${value.toFixed(value % 1 ? 1 : 0)}%`; }
function duration(value: number | null) {
  if (value === null) return "—";
  if (value < 60) return `${Math.round(value)} sec`;
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

export function QualityRollout() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<QualityData | null>(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [evidenceFeedback, setEvidenceFeedback] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await authenticatedFetch("/api/quality", { cache: "no-store" });
      if (!response.ok) throw new Error("quality_unavailable");
      setData(await response.json() as QualityData); setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function changeStage(target: Stage) {
    if (!data) return;
    setBusy(true); setFeedback("");
    try {
      const response = await authenticatedFetch("/api/quality", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_stage: target, rationale: rationale.trim() }),
      });
      const body = await response.json() as QualityData & { error?: string };
      if (!response.ok) throw new Error(body.error || "quality_update_failed");
      setData(body); setRationale("");
      setFeedback(target === "baseline"
        ? "Rollout evidence was preserved and the quality stage returned to baseline. Use the GHL emergency control to stop provider actions immediately."
        : `${stageName[target]} was authorized from reviewed evidence. This decision did not activate a provider or send a message.`);
    } catch (error) {
      const code = error instanceof Error ? error.message : "quality_update_failed";
      setFeedback(code === "quality_sample_gate_failed" ? "The required reviewed sample is incomplete."
        : code === "quality_threshold_gate_failed" ? "The latest evaluation does not meet every safety threshold."
          : "Tanaghom could not record the rollout decision.");
    } finally { setBusy(false); }
  }

  async function evidenceAction(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setEvidenceFeedback("");
    try {
      const response = await authenticatedFetch("/api/quality", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const body = await response.json() as QualityData & { error?: string };
      if (!response.ok) throw new Error(body.error || "quality_evidence_failed");
      setData(body); setEvidenceFeedback(action === "approve_default_metrics" ? "Metric formulas and conservative thresholds approved."
        : action === "import_baseline" ? "De-identified baseline imported. Review it before recording evidence."
          : action === "record_baseline" ? "Human baseline snapshot recorded."
            : action === "queue_shadow" ? "Proposal-only shadow jobs queued. The inactive worker must be run under platform control."
              : "AI shadow snapshot recorded for owner review.");
    } catch (error) {
      const code = error instanceof Error ? error.message : "quality_evidence_failed";
      setEvidenceFeedback(code === "quality_import_contains_pii" ? "Import refused: remove personal identifiers and attest de-identification."
        : code === "quality_metrics_required" ? "Approve the metric program before importing evidence."
          : "Tanaghom could not complete this evidence action.");
    } finally { setBusy(false); }
  }

  async function importFile(file: File | null) {
    if (!file) return;
    try { await evidenceAction("import_baseline", { dataset: JSON.parse(await file.text()) }); }
    catch { setEvidenceFeedback("The selected file is not valid JSON."); }
  }

  if (state === "loading") return <QualityLoading />;
  if (state === "error" || !data) return <div className="page-stack"><PageHeading title="Quality & rollout" description="Compare human and AI outcomes before increasing autonomy." /><section className="settings-state"><CircleAlert size={24} /><div><h2>Quality evidence is unavailable</h2><p>Tanaghom will not show sample metrics or allow a rollout decision without the source-of-truth snapshot.</p></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />Try again</button></section></div>;

  const currentIndex = stages.findIndex((stage) => stage.id === data.policy.current_stage);
  const latest = data.snapshots.find((item) => item.cohort === (data.policy.current_stage === "baseline" ? "human_baseline" : data.policy.current_stage === "shadow" ? "ai_shadow" : data.policy.current_stage === "assisted" ? "assisted" : "bounded_autonomous")) || null;

  return <div className="page-stack quality-page">
    <PageHeading title="Quality & rollout" description="Prove that agent work is faster, safer, and commercially useful before giving it more autonomy." actions={<Link className="secondary-button" href="/settings/integrations"><ShieldCheck size={16} />Automation controls</Link>} />

    <section className="quality-safety" aria-labelledby="quality-safety-title">
      <div className="quality-safety-icon"><LockKeyhole size={20} /></div>
      <div><h2 id="quality-safety-title">Evidence authorizes a stage—not a provider action</h2><p>Promotion here never activates n8n, clears an emergency stop, or sends a customer message. Runtime and channel controls remain separate and fail closed.</p></div>
      <StatusPill tone={data.policy.current_stage === "baseline" ? "neutral" : "success"}>{stageName[data.policy.current_stage]}</StatusPill>
    </section>

    <section className="quality-setup" aria-labelledby="quality-setup-title">
      <header><div><h2 id="quality-setup-title">Baseline → shadow evidence setup</h2><p>Import reviewed, de-identified conversations and compare proposal-only AI answers. Nothing in this workspace sends a message.</p></div><Database size={18} /></header>
      <div className="quality-setup-grid">
        <article><span>1</span><div><strong>Approve measurement rules</strong><p>Version the formulas and conservative gates used for every comparison.</p></div><button className="secondary-button" type="button" disabled={!data.viewer.can_promote || busy || data.evidence_setup.metric_programs.some(program => program.status === "approved")} onClick={() => void evidenceAction("approve_default_metrics")}>{data.evidence_setup.metric_programs.some(program => program.status === "approved") ? "Rules approved" : "Review & approve"}</button></article>
        <article><span>2</span><div><strong>Import human baseline</strong><p>JSON only. Tanaghom rejects common PII patterns and requires an explicit removal attestation.</p></div><label className={`secondary-button ${!data.viewer.can_promote || busy ? "is-disabled" : ""}`}><Upload size={15} />Choose JSON<input type="file" accept="application/json,.json" disabled={!data.viewer.can_promote || busy} onChange={(event) => void importFile(event.target.files?.[0] || null)} /></label></article>
        <article><span>3</span><div><strong>Run shadow comparison</strong><p>Gemma creates offline proposals. Provider actions remain impossible in this evaluator.</p></div><StatusPill tone="neutral">Platform-controlled</StatusPill></article>
      </div>
      {data.evidence_setup.datasets.length ? <div className="quality-datasets">{data.evidence_setup.datasets.map(dataset => <article key={dataset.id}><div><strong>{dataset.name}</strong><p>{dataset.case_count.toLocaleString()} reviewed cases · {dataset.status.replaceAll("_", " ")} · imported {date(dataset.imported_at)}</p></div><div className="quality-dataset-actions">
        {dataset.status === "ready" ? <button className="secondary-button" disabled={busy || !data.viewer.can_promote} onClick={() => void evidenceAction("record_baseline", { dataset_id: dataset.id })}>Record baseline</button> : null}
        {dataset.status === "baseline_recorded" && data.policy.current_stage === "shadow" ? <button className="primary-button" disabled={busy || !data.viewer.can_promote} onClick={() => void evidenceAction("queue_shadow", { dataset_id: dataset.id })}>Queue shadow</button> : null}
        {dataset.status === "shadow_complete" ? <button className="primary-button" disabled={busy || !data.viewer.can_promote} onClick={() => void evidenceAction("record_shadow", { dataset_id: dataset.id })}>Record comparison</button> : null}
        {dataset.job_count ? <small>{dataset.succeeded_jobs}/{dataset.job_count} evaluated{dataset.failed_jobs ? ` · ${dataset.failed_jobs} failed` : ""}</small> : null}
      </div></article>)}</div> : <div className="quality-setup-empty">No customer evidence imported yet. Start with the documented de-identified JSON template.</div>}
      {evidenceFeedback ? <p className="quality-feedback" role="status" aria-live="polite">{evidenceFeedback}</p> : null}
    </section>

    <dl className="quality-summary" aria-label="Current quality evidence">
      <QualityMetric label="Reviewed sample" value={latest ? latest.sample_size.toLocaleString() : "—"} detail={latest ? latest.cohort.replaceAll("_", " ") : "No evidence imported"} />
      <QualityMetric label="Groundedness" value={latest ? percent(latest.groundedness_percent) : "—"} detail="Source-supported responses" />
      <QualityMetric label="Response time" value={latest ? duration(latest.average_response_seconds) : "—"} detail="Average observed" />
      <QualityMetric label="Won rate" value={latest ? percent(latest.won_percent) : "—"} detail="Reported, not causal proof" />
    </dl>

    <section className="quality-rollout" aria-labelledby="rollout-path-title">
      <header><div><h2 id="rollout-path-title">Controlled rollout path</h2><p>Every increase is sequential, evidence-backed, and owner-approved.</p></div><span>Stage {currentIndex + 1} of {stages.length}</span></header>
      <ol>{stages.map((stage, index) => {
        const status = index < currentIndex ? "complete" : index === currentIndex ? "current" : "locked";
        return <li key={stage.id} className={`rollout-step rollout-step-${status}`}>
          <span className="rollout-step-marker">{status === "complete" ? <CheckCircle2 size={16} /> : status === "current" ? <Gauge size={16} /> : <LockKeyhole size={14} />}</span>
          <div><strong>{stage.label}</strong><p>{stage.copy}</p></div>
          {index < stages.length - 1 ? <ArrowRight className="rollout-step-arrow" size={15} aria-hidden="true" /> : null}
        </li>;
      })}</ol>
    </section>

    <div className="quality-workspace">
      <section className="quality-gate" aria-labelledby="promotion-gate-title">
        <header><div><h2 id="promotion-gate-title">Promotion gate</h2><p>{data.promotion_gate.next_stage ? `Requirements for ${stageName[data.promotion_gate.next_stage]}.` : "The configured pilot ceiling has been reached."}</p></div><StatusPill tone={data.promotion_gate.ready ? "success" : "attention"}>{data.promotion_gate.ready ? "Ready for owner review" : "Evidence incomplete"}</StatusPill></header>
        <ul>{data.promotion_gate.requirements.map((requirement) => <li key={requirement.key} className={requirement.passed ? "gate-passed" : ""}>{requirement.passed ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}<span>{requirement.label}</span></li>)}</ul>
        <div className="quality-decision">
          <label htmlFor="quality-rationale"><span>Owner decision rationale</span><textarea id="quality-rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} minLength={3} maxLength={1000} placeholder="Explain why the evidence supports this decision." disabled={!data.viewer.can_promote || busy} /></label>
          <div>
            {data.policy.current_stage !== "baseline" ? <button className="ghost-button" type="button" disabled={!data.viewer.can_promote || busy || rationale.trim().length < 3} onClick={() => void changeStage("baseline")}><RotateCcw size={15} />Return to baseline</button> : null}
            {data.promotion_gate.next_stage ? <button className="primary-button" type="button" disabled={!data.viewer.can_promote || busy || !data.promotion_gate.ready || rationale.trim().length < 3} onClick={() => void changeStage(data.promotion_gate.next_stage!)}>{busy ? "Recording…" : `Authorize ${stageName[data.promotion_gate.next_stage]}`}</button> : null}
          </div>
          {!data.viewer.can_promote ? <p>Only an accepted organization owner can record rollout decisions.</p> : null}
          {feedback ? <p className="quality-feedback" role="status" aria-live="polite">{feedback}</p> : null}
        </div>
      </section>

      <section className="quality-evidence" aria-labelledby="quality-evidence-title">
        <header><div><h2 id="quality-evidence-title">Comparison evidence</h2><p>Latest version-attributed snapshot for each handling model.</p></div><FlaskConical size={18} /></header>
        <div className="quality-evidence-list">{cohorts.map((cohort) => <EvidenceRow key={cohort.id} definition={cohort} snapshot={data.snapshots.find((item) => item.cohort === cohort.id) || null} />)}</div>
      </section>
    </div>

    <section className="quality-decisions" aria-labelledby="quality-decisions-title">
      <header><div><h2 id="quality-decisions-title">Decision history</h2><p>Immutable promotion and rollback decisions with human rationale.</p></div><Clock3 size={18} /></header>
      {data.decisions.length ? <ol>{data.decisions.map((decision) => <li key={decision.id}><span className={`decision-icon decision-${decision.decision}`}>{decision.decision === "promote" ? <CheckCircle2 size={16} /> : <RotateCcw size={16} />}</span><div><strong>{decision.decision === "promote" ? `Promoted to ${stageName[decision.to_stage]}` : `Returned to ${stageName[decision.to_stage]}`}</strong><p>{decision.rationale}</p><small>{date(decision.decided_at)} · {decision.decided_by_name}</small></div></li>)}</ol> : <div className="quality-empty"><UsersRound size={21} /><div><strong>No rollout decision yet</strong><p>Tanaghom starts at the human baseline and preserves this empty state until real evidence is reviewed.</p></div></div>}
    </section>
    <p className="quality-observed">Snapshot observed {date(data.observed_at)}. Missing data is shown as “—”; Tanaghom never substitutes fixtures for live evidence.</p>
  </div>;
}

function QualityMetric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div><dt>{label}</dt><dd>{value}</dd><span>{detail}</span></div>; }

function EvidenceRow({ definition, snapshot }: { definition: typeof cohorts[number]; snapshot: Snapshot | null }) {
  return <article className="evidence-row">
    <div className="evidence-identity"><span className={snapshot ? "evidence-ready" : ""}>{snapshot ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}</span><div><strong>{definition.label}</strong><p>{definition.copy}</p></div></div>
    {snapshot ? <><dl><div><dt>Sample</dt><dd>{snapshot.sample_size.toLocaleString()}</dd></div><div><dt>Qualified</dt><dd>{percent(snapshot.qualification_percent)}</dd></div><div><dt>Booked</dt><dd>{percent(snapshot.booking_percent)}</dd></div><div><dt>Complaints</dt><dd>{percent(snapshot.complaint_percent)}</dd></div></dl><small>{date(snapshot.period_end)} · {snapshot.limitations}</small></> : <p className="evidence-missing">Awaiting a reviewed, version-attributed snapshot.</p>}
  </article>;
}

function QualityLoading() { return <div className="page-stack"><PageHeading title="Quality & rollout" description="Compare human and AI outcomes before increasing autonomy." /><div className="quality-loading" aria-label="Loading quality evidence" aria-busy="true"><span className="state-skeleton state-skeleton-block" /><span className="state-skeleton state-skeleton-block" /><span className="state-skeleton state-skeleton-block" /></div></div>; }
