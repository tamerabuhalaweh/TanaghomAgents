"use client";

import {
  ArchiveRestore,
  BookCheck,
  CheckCircle2,
  CircleAlert,
  FilePlus2,
  Languages,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import type { Tone } from "@/data/fixtures";

type KnowledgeStatus = "draft" | "reviewed" | "approved" | "active" | "superseded" | "revoked";
type LifecycleAction = "review" | "approve" | "activate" | "revoke" | "rollback";

interface KnowledgeVersion {
  source_id: string;
  source_key: string;
  title: string;
  category: string;
  provenance_type: string;
  provenance_ref: string | null;
  version_id: string;
  version_number: number;
  status: KnowledgeStatus;
  language: "en" | "ar" | "und";
  content: string;
  content_fingerprint: string;
  created_at: string;
  activated_at: string | null;
  revoked_reason: string | null;
  created_by_name: string;
}

interface KnowledgePayload {
  versions: KnowledgeVersion[];
  counts: { sources: number; active: number; awaiting_review: number; revoked: number };
  policy: null | {
    version_number: number;
    confidence_threshold: string;
    supported_languages: string[];
    mandatory_escalations: string[];
    forbidden_topics: string[];
    sensitive_data_rules: string[];
    prompt_version: string;
    activated_at: string;
  };
  proposal_stats: { total: number; escalated: number; ungrounded: number };
}

const statusTone: Record<KnowledgeStatus, Tone> = {
  draft: "neutral", reviewed: "working", approved: "attention", active: "success",
  superseded: "neutral", revoked: "danger",
};
const categoryLabels: Record<string, string> = {
  product: "Product", service: "Service", pricing: "Pricing", faq: "FAQ",
  policy: "Policy", offer: "Offer", objection: "Objection handling",
  qualification: "Qualification", location: "Location", hours: "Hours",
  escalation_rule: "Escalation rule", disclaimer: "Disclaimer",
  dialect_example: "Dialect example",
};
const actionLabels: Record<LifecycleAction, string> = {
  review: "Mark reviewed", approve: "Approve", activate: "Activate",
  revoke: "Revoke", rollback: "Restore version",
};
const nextActions: Record<KnowledgeStatus, LifecycleAction[]> = {
  draft: ["review"], reviewed: ["approve", "revoke"], approved: ["activate", "revoke"],
  active: ["revoke"], superseded: ["rollback"], revoked: [],
};

function formatted(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not yet";
}

export function KnowledgeManagement() {
  const [payload, setPayload] = useState<KnowledgePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [composerOpen, setComposerOpen] = useState(false);
  const [filter, setFilter] = useState<KnowledgeStatus | "all">("all");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await authenticatedFetch("/api/admin/knowledge");
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("knowledge_load_failed");
      setPayload(await response.json() as KnowledgePayload);
      setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => payload?.versions.filter((version) => filter === "all" || version.status === filter) || [], [filter, payload]);

  return <div className="page-stack knowledge-page">
    <PageHeading
      title="Sales knowledge"
      description="Control exactly which customer facts, policies, offers, and language examples the Sales Agent may use in response proposals."
      actions={<button className="primary-button" type="button" onClick={() => setComposerOpen((value) => !value)}><FilePlus2 size={17} /> {composerOpen ? "Close draft" : "Add knowledge"}</button>}
    />

    {state === "loading" ? <KnowledgeLoading /> : null}
    {state === "forbidden" ? <KnowledgeState icon={<ShieldCheck />} title="Admin access required" copy="Only a Tanaghom Admin can review, approve, activate, revoke, or restore customer knowledge." /> : null}
    {state === "error" ? <KnowledgeState icon={<CircleAlert />} title="Knowledge catalog unavailable" copy="Tanaghom could not load the protected organization catalog." action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={16} /> Try again</button>} /> : null}

    {state === "ready" && payload ? <>
      <section className="knowledge-safety" aria-label="Knowledge safety boundary">
        <ShieldCheck size={20} />
        <div><strong>Proposal-only grounding is enforced</strong><p>Only active versions can be retrieved. Every factual proposal must cite the exact version, while uncertain or sensitive cases go to a person.</p></div>
        <StatusPill tone="success">No auto-reply</StatusPill>
      </section>

      {composerOpen ? <KnowledgeComposer onCreated={async () => { setComposerOpen(false); setFeedback("Draft created. Review and activate it before agents can retrieve it."); await load(); }} /> : null}

      <section className="knowledge-overview" aria-label="Knowledge catalog summary">
        <dl>
          <div><dt>Sources</dt><dd>{payload.counts.sources}</dd></div>
          <div><dt>Active versions</dt><dd>{payload.counts.active}</dd></div>
          <div><dt>Awaiting review</dt><dd>{payload.counts.awaiting_review}</dd></div>
          <div><dt>Revoked</dt><dd>{payload.counts.revoked}</dd></div>
        </dl>
        <div className="knowledge-policy-summary">
          <Languages size={18} />
          <span><strong>English and Arabic policy v{payload.policy?.version_number || "—"}</strong><small>Confidence below {payload.policy ? `${Math.round(Number(payload.policy.confidence_threshold) * 100)}%` : "the policy threshold"} requires human review.</small></span>
        </div>
      </section>

      <section className="knowledge-catalog" aria-labelledby="knowledge-catalog-title">
        <header className="knowledge-catalog-header">
          <div><h2 id="knowledge-catalog-title">Version catalog</h2><p>Drafts are invisible to agents until reviewed, approved, and activated.</p></div>
          <label><span className="sr-only">Filter versions by status</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All statuses</option>{Object.keys(nextActions).map((status) => <option value={status} key={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>
        </header>
        {visible.length ? <div className="knowledge-version-list">{visible.map((version) => <KnowledgeRow key={version.version_id} version={version} onChanged={async (message) => { setFeedback(message); await load(); }} />)}</div> : <div className="knowledge-empty"><BookCheck size={22} /><div><h3>{payload.versions.length ? "No versions match this filter" : "Build the approved answer set"}</h3><p>{payload.versions.length ? "Choose another lifecycle status to continue." : "Add a customer-supplied fact, policy, FAQ, offer, or language example as a draft."}</p></div></div>}
      </section>
      {feedback ? <p className="integration-feedback" role="status" aria-live="polite">{feedback}</p> : null}
    </> : null}
  </div>;
}

function KnowledgeComposer({ onCreated }: { onCreated: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("faq");
  const [language, setLanguage] = useState("en");
  const [provenanceType, setProvenanceType] = useState("customer_entry");
  const [provenanceRef, setProvenanceRef] = useState("");
  const [content, setContent] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await authenticatedFetch("/api/admin/knowledge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_key: sourceKey, title, category, language, content,
          provenance_type: provenanceType, provenance_ref: provenanceRef, structured_facts: [] }),
      });
      if (!response.ok) throw new Error("The draft could not be created. Check the source key and required fields.");
      await onCreated();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The draft could not be created."); }
    finally { setBusy(false); }
  }

  return <form className="knowledge-composer" onSubmit={(event) => void submit(event)}>
    <header><div><h2>New immutable version</h2><p>Reuse a source key to add a new version. Existing approved text is never edited in place.</p></div><StatusPill tone="neutral">Draft</StatusPill></header>
    <div className="knowledge-form-grid">
      <label><span>Source key</span><input value={sourceKey} onChange={(event) => setSourceKey(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} pattern="[a-z][a-z0-9_-]{2,79}" placeholder="pricing_standard" required /><small>Stable identifier; lowercase letters, numbers, dashes, or underscores.</small></label>
      <label><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={200} placeholder="Standard service pricing" required /></label>
      <label><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Language</span><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en">English</option><option value="ar">Arabic</option><option value="und">Language-neutral</option></select></label>
      <label><span>Provenance</span><select value={provenanceType} onChange={(event) => setProvenanceType(event.target.value)}><option value="customer_entry">Customer entry</option><option value="customer_document">Customer document</option><option value="approved_url">Approved URL</option><option value="legal_policy">Legal policy</option><option value="operator_note">Operator note</option></select></label>
      <label><span>Source reference <em>Optional</em></span><input value={provenanceRef} onChange={(event) => setProvenanceRef(event.target.value)} maxLength={1000} placeholder="Document name or approved URL" /></label>
      <label className="knowledge-content-field"><span>Approved-answer material</span><textarea dir={language === "ar" ? "rtl" : "ltr"} value={content} onChange={(event) => setContent(event.target.value)} minLength={3} maxLength={30000} rows={7} placeholder="Enter only customer-supplied facts and wording that reviewers can verify." required /><small>Do not include passwords, access tokens, payment card data, or unnecessary personal information.</small></label>
    </div>
    <footer><div>{error ? <p role="alert">{error}</p> : <p>Saving creates a draft only. Agents cannot retrieve it.</p>}</div><button className="primary-button" type="submit" disabled={busy}>{busy ? "Creating draft…" : "Create draft"}</button></footer>
  </form>;
}

function KnowledgeRow({ version, onChanged }: { version: KnowledgeVersion; onChanged: (message: string) => Promise<void> }) {
  const [busy, setBusy] = useState<LifecycleAction | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function transition(action: LifecycleAction) {
    if (action === "revoke" && !revokeOpen) { setRevokeOpen(true); return; }
    setBusy(action); setError("");
    try {
      const response = await authenticatedFetch(`/api/admin/knowledge/${version.version_id}/transition`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: action === "revoke" ? reason : undefined }),
      });
      if (!response.ok) throw new Error("This lifecycle transition was rejected. Refresh and verify the current version state.");
      setRevokeOpen(false); setReason("");
      await onChanged(action === "activate" ? "Knowledge activated for future proposals." : action === "rollback" ? "Earlier version restored; the previous active version was superseded." : `Version ${actionLabels[action].toLowerCase()}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The version could not be updated."); }
    finally { setBusy(null); }
  }

  return <article className="knowledge-version-row">
    <div className="knowledge-version-main">
      <div className="knowledge-version-title"><div><h3>{version.title}</h3><p>{categoryLabels[version.category] || version.category} · {version.language === "ar" ? "Arabic" : version.language === "en" ? "English" : "Language-neutral"} · v{version.version_number}</p></div><StatusPill tone={statusTone[version.status]}>{version.status}</StatusPill></div>
      <details><summary>View source content and provenance</summary><div className="knowledge-version-detail"><p dir={version.language === "ar" ? "rtl" : "ltr"}>{version.content}</p><dl><div><dt>Source key</dt><dd>{version.source_key}</dd></div><div><dt>Created by</dt><dd>{version.created_by_name}</dd></div><div><dt>Provenance</dt><dd>{version.provenance_ref || version.provenance_type.replaceAll("_", " ")}</dd></div><div><dt>Fingerprint</dt><dd><code>{version.content_fingerprint}</code></dd></div><div><dt>Activated</dt><dd>{formatted(version.activated_at)}</dd></div></dl>{version.revoked_reason ? <p className="knowledge-revoked-reason"><ShieldX size={15} /> {version.revoked_reason}</p> : null}</div></details>
    </div>
    <div className="knowledge-version-actions">
      {nextActions[version.status].map((action) => <button key={action} className={action === "revoke" ? "text-danger-button compact-button" : action === "activate" ? "primary-button compact-button" : "secondary-button compact-button"} type="button" disabled={Boolean(busy)} onClick={() => void transition(action)}>{action === "rollback" ? <ArchiveRestore size={15} /> : action === "activate" ? <CheckCircle2 size={15} /> : null}{busy === action ? "Working…" : actionLabels[action]}</button>)}
      {revokeOpen ? <div className="knowledge-revoke"><label><span>Reason for revocation</span><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} autoFocus /></label><div><button className="danger-button compact-button" type="button" disabled={reason.trim().length < 3 || Boolean(busy)} onClick={() => void transition("revoke")}>Confirm revoke</button><button className="ghost-button compact-button" type="button" onClick={() => { setRevokeOpen(false); setReason(""); }}>Cancel</button></div></div> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </article>;
}

function KnowledgeState({ icon, title, copy, action }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode }) {
  return <section className="domain-empty">{icon}<div><h2>{title}</h2><p>{copy}</p></div>{action}</section>;
}

function KnowledgeLoading() {
  return <div className="knowledge-loading" aria-label="Loading sales knowledge"><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></div>;
}
