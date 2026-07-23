"use client";

import {
  Archive,
  BookOpenCheck,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CopyPlus,
  Download,
  FileCheck2,
  Filter,
  Languages,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import type { Tone } from "@/data/fixtures";

type Lifecycle = "draft" | "validated" | "published" | "superseded" | "retired";
type SkillClass = "knowledge" | "proposal_instruction" | "read" | "proposal" | "action";

interface AssignedAgent {
  role_code: string;
  worker_code: string;
  state: string;
}

interface PlatformSkill {
  skill_id: string;
  version_id: string;
  code: string;
  display_name: string;
  description: string;
  skill_class: SkillClass;
  version_number: number;
  lifecycle_state: Lifecycle;
  risk_class: string;
  side_effect_class: string;
  permission_manifest: {
    data_domains: string[];
    integrations: string[];
    channels: string[];
    operations: string[];
  };
  integration_requirements: string[];
  content_hash: string;
  instructions: string;
  input_schema_ref: string;
  output_schema_ref: string;
  assigned_agents: AssignedAgent[];
}

interface OrganizationReference {
  id: string;
  reference_type: string;
  reference_key: string;
  title: string;
  language: string;
  provenance: string;
  expires_at: string | null;
  content_hash: string;
}

interface OrganizationSkill {
  skill_id: string;
  version_id: string;
  code: string;
  display_name: string;
  description: string;
  skill_class: "knowledge" | "proposal_instruction";
  version_number: number;
  lifecycle_state: Lifecycle;
  risk_class: string;
  side_effect_class: "proposal_only";
  activation_guidance: string;
  instructions: string;
  examples: string[];
  expected_inputs: string[];
  expected_outputs: string[];
  escalation_conditions: string;
  languages: Array<"en" | "ar">;
  content_hash: string;
  validation_report: null | { checked_boundaries?: string[] };
  validated_at: string | null;
  published_at: string | null;
  retired_at: string | null;
  created_at: string;
  created_by_name: string;
  references: OrganizationReference[];
  audit_events: Array<{ event_type: string; occurred_at: string; actor_name: string }>;
  assigned_agents: AssignedAgent[];
}

interface SkillLibraryPayload {
  can_manage: boolean;
  platform_skills: PlatformSkill[];
  organization_skills: OrganizationSkill[];
  counts: { platform: number; organization: number; drafts: number; published: number };
}

interface DraftState {
  code: string;
  skill_class: "knowledge" | "proposal_instruction";
  display_name: string;
  description: string;
  activation_guidance: string;
  instructions: string;
  examples: string;
  expected_inputs: string;
  expected_outputs: string;
  escalation_conditions: string;
  languages: Array<"en" | "ar">;
  reference_type: "knowledge_collection" | "approved_document" | "approved_asset";
  reference_key: string;
  reference_title: string;
  reference_provenance: string;
  clone_source_version_id: string | null;
}

const emptyDraft: DraftState = {
  code: "",
  skill_class: "knowledge",
  display_name: "",
  description: "",
  activation_guidance: "",
  instructions: "",
  examples: "",
  expected_inputs: "customer_question",
  expected_outputs: "grounded_guidance",
  escalation_conditions: "Escalate when the approved material does not answer the request.",
  languages: ["en"],
  reference_type: "knowledge_collection",
  reference_key: "",
  reference_title: "",
  reference_provenance: "",
  clone_source_version_id: null,
};

const lifecycleTone: Record<Lifecycle, Tone> = {
  draft: "neutral",
  validated: "working",
  published: "success",
  superseded: "attention",
  retired: "danger",
};

const classLabels: Record<SkillClass, string> = {
  knowledge: "Knowledge",
  proposal_instruction: "Proposal instruction",
  read: "Read",
  proposal: "Proposal",
  action: "Action",
};

function formatted(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Not yet";
}

function readable(value: string) {
  return value.replaceAll("_", " ").replaceAll(".", " · ");
}

function csv(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function SkillLibrary() {
  const [payload, setPayload] = useState<SkillLibraryPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [composerOpen, setComposerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<"all" | "platform" | "organization">("all");
  const [classFilter, setClassFilter] = useState<"all" | SkillClass>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<"all" | Lifecycle>("all");
  const [feedback, setFeedback] = useState("");
  const [draft, setDraft] = useState<DraftState>(emptyDraft);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await authenticatedFetch("/api/admin/skills");
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("skill_library_load_failed");
      setPayload(await response.json() as SkillLibraryPayload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visiblePlatform = useMemo(() => (payload?.platform_skills || []).filter((skill) =>
    ownerFilter !== "organization"
    && (classFilter === "all" || skill.skill_class === classFilter)
    && (lifecycleFilter === "all" || skill.lifecycle_state === lifecycleFilter)
    && `${skill.display_name} ${skill.description} ${skill.code}`.toLowerCase().includes(search.toLowerCase()),
  ), [classFilter, lifecycleFilter, ownerFilter, payload, search]);

  const visibleOrganization = useMemo(() => (payload?.organization_skills || []).filter((skill) =>
    ownerFilter !== "platform"
    && (classFilter === "all" || skill.skill_class === classFilter)
    && (lifecycleFilter === "all" || skill.lifecycle_state === lifecycleFilter)
    && `${skill.display_name} ${skill.description} ${skill.code}`.toLowerCase().includes(search.toLowerCase()),
  ), [classFilter, lifecycleFilter, ownerFilter, payload, search]);

  function cloneSkill(skill: OrganizationSkill) {
    setDraft({
      code: `${skill.code}_copy`,
      skill_class: skill.skill_class,
      display_name: `${skill.display_name} copy`,
      description: skill.description,
      activation_guidance: skill.activation_guidance,
      instructions: skill.instructions,
      examples: skill.examples.join("\n"),
      expected_inputs: skill.expected_inputs.join(", "),
      expected_outputs: skill.expected_outputs.join(", "),
      escalation_conditions: skill.escalation_conditions,
      languages: skill.languages,
      reference_type: "knowledge_collection",
      reference_key: "",
      reference_title: "",
      reference_provenance: "",
      clone_source_version_id: skill.version_id,
    });
    setComposerOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <div className="page-stack skill-library-page">
    <PageHeading
      title="Skill Library"
      description="Discover reviewed platform capabilities and create safe, versioned organization guidance without code, credentials, or n8n access."
      actions={payload?.can_manage ? <button className="primary-button" type="button" onClick={() => {
        setComposerOpen((open) => !open);
        if (composerOpen) setDraft(emptyDraft);
      }}>{composerOpen ? <X size={17} /> : <Plus size={17} />}{composerOpen ? "Close builder" : "Create skill"}</button> : undefined}
    />

    {state === "loading" ? <SkillLoading /> : null}
    {state === "forbidden" ? <SkillState icon={<LockKeyhole />} title="Skill Library access is restricted" copy="Your accepted organization role does not include this workspace." /> : null}
    {state === "error" ? <SkillState icon={<CircleAlert />} title="Skill Library unavailable" copy="Tanaghom could not load the protected skill catalog." action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={16} /> Try again</button>} /> : null}

    {state === "ready" && payload ? <>
      <section className="skill-safety" aria-label="Customer skill safety boundary">
        <ShieldCheck size={21} />
        <div>
          <strong>Customer skills are guidance, never executable code</strong>
          <p>Publishing creates an immutable version. It cannot reveal credentials, call providers, change permissions, activate n8n, or modify a running agent.</p>
        </div>
        <StatusPill tone="success">Governed</StatusPill>
      </section>

      {composerOpen && payload.can_manage ? <SkillComposer draft={draft} setDraft={setDraft} onCreated={async () => {
        setComposerOpen(false);
        setDraft(emptyDraft);
        setFeedback("Draft created. Validate it before publishing; no agent assignment changed.");
        await load();
      }} /> : null}

      <section className="skill-summary" aria-label="Skill Library summary">
        <dl>
          <div><dt>Platform skills</dt><dd>{payload.counts.platform}</dd></div>
          <div><dt>Organization skills</dt><dd>{payload.counts.organization}</dd></div>
          <div><dt>Draft versions</dt><dd>{payload.counts.drafts}</dd></div>
          <div><dt>Published versions</dt><dd>{payload.counts.published}</dd></div>
        </dl>
        <div><Languages size={18} /><span><strong>English and Arabic ready</strong><small>Direction-aware authoring, preview, and validation.</small></span></div>
      </section>

      <section className="skill-catalog" aria-labelledby="skill-catalog-title">
        <header className="skill-catalog-header">
          <div><h2 id="skill-catalog-title">Governed catalog</h2><p>Inspect exact versions, permissions, validation, assignments, blockers, and history.</p></div>
          <div className="skill-filters">
            <label className="skill-search"><Search size={16} /><span className="sr-only">Search skills</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search skills" /></label>
            <label><Filter size={15} /><span className="sr-only">Filter by owner</span><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value as typeof ownerFilter)}><option value="all">All owners</option><option value="platform">Platform</option><option value="organization">Organization</option></select></label>
            <label><span className="sr-only">Filter by class</span><select value={classFilter} onChange={(event) => setClassFilter(event.target.value as typeof classFilter)}><option value="all">All classes</option>{Object.entries(classLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span className="sr-only">Filter by lifecycle</span><select value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value as typeof lifecycleFilter)}><option value="all">All states</option>{Object.keys(lifecycleTone).map((value) => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
          </div>
        </header>

        {visiblePlatform.length || visibleOrganization.length ? <div className="skill-list">
          {visibleOrganization.map((skill) => <OrganizationSkillRow key={skill.version_id} skill={skill} canManage={payload.can_manage} onClone={() => cloneSkill(skill)} onChanged={async (message) => { setFeedback(message); await load(); }} />)}
          {visiblePlatform.map((skill) => <PlatformSkillRow key={skill.version_id} skill={skill} />)}
        </div> : <div className="skill-empty"><BookOpenCheck size={23} /><div><h3>No skills match these filters</h3><p>Clear one or more filters, or create a governed organization skill.</p></div></div>}
      </section>
      {feedback ? <p className="integration-feedback" role="status" aria-live="polite">{feedback}</p> : null}
    </> : null}
  </div>;
}

function SkillComposer({ draft, setDraft, onCreated }: {
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  onCreated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [referenceOpen, setReferenceOpen] = useState(Boolean(draft.reference_key));
  const direction = draft.languages.length === 1 && draft.languages[0] === "ar" ? "rtl" : "ltr";

  function update<Key extends keyof DraftState>(key: Key, value: DraftState[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const hasReference = draft.reference_key || draft.reference_title || draft.reference_provenance;
    try {
      const response = await authenticatedFetch("/api/admin/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          examples: csv(draft.examples),
          expected_inputs: csv(draft.expected_inputs),
          expected_outputs: csv(draft.expected_outputs),
          references: hasReference ? [{
            reference_type: draft.reference_type,
            reference_key: draft.reference_key,
            title: draft.reference_title,
            language: draft.languages.length === 1 ? draft.languages[0] : "und",
            provenance: draft.reference_provenance,
          }] : [],
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; details?: Array<{ field: string; message: string }> };
      if (!response.ok) {
        throw new Error(body.details?.[0]?.message || "The skill draft was rejected by the safety validator.");
      }
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The skill draft could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="skill-composer" onSubmit={(event) => void submit(event)}>
    <header>
      <div><h2>{draft.clone_source_version_id ? "Clone into a new governed skill" : "New organization skill"}</h2><p>Every save creates a new immutable draft version. Only safe instruction and knowledge classes are available.</p></div>
      <StatusPill tone="neutral">Draft only</StatusPill>
    </header>
    <div className="skill-builder-grid">
      <section>
        <h3><span>1</span> Identity and use</h3>
        <div className="skill-form-grid">
          <label><span>Skill code</span><input value={draft.code} onChange={(event) => update("code", event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} pattern="[a-z][a-z0-9_]{2,79}" placeholder="pricing_guidance" required /><small>Stable organization identifier.</small></label>
          <label><span>Class</span><select value={draft.skill_class} onChange={(event) => update("skill_class", event.target.value as DraftState["skill_class"])}><option value="knowledge">Knowledge</option><option value="proposal_instruction">Proposal instruction</option></select></label>
          <label className="wide"><span>Name</span><input dir={direction} value={draft.display_name} onChange={(event) => update("display_name", event.target.value)} minLength={3} maxLength={120} placeholder="Service pricing guidance" required /></label>
          <label className="wide"><span>Description</span><textarea dir={direction} value={draft.description} onChange={(event) => update("description", event.target.value)} minLength={20} maxLength={1000} rows={3} placeholder="Explain the business outcome and boundary of this skill." required /></label>
          <label className="wide"><span>When agents should use it</span><textarea dir={direction} value={draft.activation_guidance} onChange={(event) => update("activation_guidance", event.target.value)} minLength={20} maxLength={2000} rows={3} placeholder="Use when a customer asks about an approved service price or package." required /></label>
          <fieldset className="wide"><legend>Languages</legend>{(["en", "ar"] as const).map((language) => <label key={language}><input type="checkbox" checked={draft.languages.includes(language)} onChange={(event) => update("languages", event.target.checked ? [...new Set([...draft.languages, language])] : draft.languages.filter((item) => item !== language))} /> {language === "en" ? "English" : "Arabic"}</label>)}</fieldset>
        </div>
      </section>
      <section>
        <h3><span>2</span> Instructions and contract</h3>
        <div className="skill-form-grid">
          <label className="wide"><span>Instructions</span><textarea dir={direction} value={draft.instructions} onChange={(event) => update("instructions", event.target.value)} minLength={20} maxLength={12000} rows={8} placeholder="Write the exact safe procedure. Do not include URLs, credentials, code, system prompts, or runtime IDs." required /><small>Plain instructions only. Executable content and hidden prompt overrides are rejected.</small></label>
          <label><span>Expected inputs</span><textarea value={draft.expected_inputs} onChange={(event) => update("expected_inputs", event.target.value)} rows={3} placeholder="customer_question, approved_context" required /><small>Comma or line separated contract tokens.</small></label>
          <label><span>Expected outputs</span><textarea value={draft.expected_outputs} onChange={(event) => update("expected_outputs", event.target.value)} rows={3} placeholder="grounded_guidance" required /></label>
          <label className="wide"><span>Escalation conditions</span><textarea dir={direction} value={draft.escalation_conditions} onChange={(event) => update("escalation_conditions", event.target.value)} minLength={10} maxLength={3000} rows={3} required /></label>
          <label className="wide"><span>Examples <em>Optional</em></span><textarea dir={direction} value={draft.examples} onChange={(event) => update("examples", event.target.value)} rows={3} placeholder="One approved example per line" /><small>Maximum ten; each example is checked independently.</small></label>
        </div>
      </section>
      <section>
        <button className="skill-reference-toggle" type="button" aria-expanded={referenceOpen} onClick={() => setReferenceOpen((open) => !open)}><span><FileCheck2 size={17} /><strong>3. Approved reference</strong><small>Optional organization-local knowledge, document, or asset metadata.</small></span><ChevronDown size={17} /></button>
        {referenceOpen ? <div className="skill-form-grid skill-reference-fields">
          <label><span>Reference type</span><select value={draft.reference_type} onChange={(event) => update("reference_type", event.target.value as DraftState["reference_type"])}><option value="knowledge_collection">Knowledge collection</option><option value="approved_document">Approved document</option><option value="approved_asset">Approved asset</option></select></label>
          <label><span>Reference key</span><input value={draft.reference_key} onChange={(event) => update("reference_key", event.target.value.toLowerCase().replace(/[^a-z0-9_./-]/g, ""))} placeholder="knowledge/pricing-policy" /><small>Organization key, never a public URL.</small></label>
          <label><span>Reference title</span><input dir={direction} value={draft.reference_title} onChange={(event) => update("reference_title", event.target.value)} placeholder="Approved pricing policy" /></label>
          <label><span>Provenance</span><input dir={direction} value={draft.reference_provenance} onChange={(event) => update("reference_provenance", event.target.value)} placeholder="Reviewed by Sales Director" /></label>
        </div> : null}
      </section>
    </div>
    <footer>
      <div>{error ? <p role="alert">{error}</p> : <p>Creation does not publish, bind, or activate anything.</p>}</div>
      <button className="primary-button" type="submit" disabled={busy || !draft.languages.length}>{busy ? "Creating draft…" : "Create immutable draft"}</button>
    </footer>
  </form>;
}

function OrganizationSkillRow({ skill, canManage, onClone, onChanged }: {
  skill: OrganizationSkill;
  canManage: boolean;
  onClone: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function transition(action: "validate" | "publish" | "retire") {
    setBusy(action);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/admin/skills/${skill.version_id}/transition`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(`The ${action} transition was rejected. Refresh and verify this exact version.`);
      await onChanged(action === "publish"
        ? "Skill published as an immutable version. Running agents remain unchanged."
        : action === "retire"
          ? "Skill retired. New Agent Studio bindings will be blocked; history remains available."
          : "Skill passed all safety checks and is ready for owner publication.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The lifecycle action failed.");
    } finally {
      setBusy("");
    }
  }

  async function exportVersion() {
    setBusy("export");
    setError("");
    try {
      const response = await authenticatedFetch(`/api/admin/skills/${skill.version_id}/export`, { method: "POST" });
      if (!response.ok) throw new Error("The portable skill export could not be created.");
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `${skill.code}-v${skill.version_number}-SKILL.md`;
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(href);
      await onChanged("Portable instruction-only skill exported and recorded in the immutable audit.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The portable skill export failed.");
    } finally {
      setBusy("");
    }
  }

  return <article className="skill-row">
    <div className="skill-row-summary">
      <span className="skill-owner-mark organization"><Sparkles size={17} /></span>
      <div>
        <div className="skill-title-line"><h3>{skill.display_name}</h3><StatusPill tone={lifecycleTone[skill.lifecycle_state]}>{readable(skill.lifecycle_state)}</StatusPill></div>
        <p>{skill.description}</p>
        <ul className="skill-meta"><li>Organization</li><li>{classLabels[skill.skill_class]}</li><li>v{skill.version_number}</li><li>{skill.languages.map((language) => language === "ar" ? "Arabic" : "English").join(" + ")}</li><li>{skill.risk_class} risk</li></ul>
      </div>
      <div className="skill-row-actions">
        {canManage && skill.lifecycle_state === "draft" ? <button className="secondary-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void transition("validate")}><ShieldCheck size={15} />{busy === "validate" ? "Validating…" : "Validate"}</button> : null}
        {canManage && skill.lifecycle_state === "validated" ? <button className="primary-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void transition("publish")}><CheckCircle2 size={15} />{busy === "publish" ? "Publishing…" : "Publish"}</button> : null}
        {canManage ? <button className="secondary-button compact-button" type="button" onClick={onClone}><CopyPlus size={15} /> Clone</button> : null}
        {canManage && ["published", "superseded"].includes(skill.lifecycle_state) ? <button className="ghost-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void transition("retire")}><Archive size={15} />{busy === "retire" ? "Retiring…" : "Retire"}</button> : null}
        {canManage ? <button className="ghost-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void exportVersion()}><Download size={15} />{busy === "export" ? "Exporting…" : "Export"}</button> : null}
      </div>
    </div>
    <details className="skill-details">
      <summary>Inspect permissions, contract, references, and audit</summary>
      <div className="skill-detail-grid">
        <section><h4>Plain-language permissions</h4><ul className="permission-list"><li><CheckCircle2 /> Can read approved inputs: {skill.expected_inputs.map(readable).join(", ")}</li><li><FileCheck2 /> Can propose: {skill.expected_outputs.map(readable).join(", ")}</li><li><LockKeyhole /> Cannot execute code, call providers, view credentials, or activate workflows</li></ul></section>
        <section><h4>Use and escalation</h4><p>{skill.activation_guidance}</p><p><strong>Escalate:</strong> {skill.escalation_conditions}</p></section>
        <section><h4>Version evidence</h4><dl><div><dt>Hash</dt><dd><code>{skill.content_hash}</code></dd></div><div><dt>Validated</dt><dd>{formatted(skill.validated_at)}</dd></div><div><dt>Published</dt><dd>{formatted(skill.published_at)}</dd></div><div><dt>Created by</dt><dd>{skill.created_by_name}</dd></div></dl></section>
        <section><h4>References</h4>{skill.references.length ? <ul>{skill.references.map((reference) => <li key={reference.id}><strong>{reference.title}</strong><small>{readable(reference.reference_type)} · {reference.language} · {reference.provenance}</small></li>)}</ul> : <p>No reference assets are attached to this version.</p>}</section>
        <section><h4>Agent assignments</h4><p>{skill.assigned_agents.length ? `${skill.assigned_agents.length} version-pinned assignment(s).` : "None. Publishing does not change running agents; assignment requires a separately validated Agent Studio version."}</p></section>
        <section><h4>Audit history</h4>{skill.audit_events.length ? <ul>{skill.audit_events.map((event, index) => <li key={`${event.occurred_at}-${index}`}><strong>{readable(event.event_type)}</strong><small>{event.actor_name} · {formatted(event.occurred_at)}</small></li>)}</ul> : <p>No lifecycle events recorded yet.</p>}</section>
      </div>
    </details>
    {error ? <p className="skill-row-error" role="alert">{error}</p> : null}
  </article>;
}

function PlatformSkillRow({ skill }: { skill: PlatformSkill }) {
  const canExecute = skill.side_effect_class === "external_write";
  return <article className="skill-row platform">
    <div className="skill-row-summary">
      <span className="skill-owner-mark"><Bot size={17} /></span>
      <div>
        <div className="skill-title-line"><h3>{skill.display_name}</h3><StatusPill tone="success">Published</StatusPill></div>
        <p>{skill.description}</p>
        <ul className="skill-meta"><li>Platform</li><li>{classLabels[skill.skill_class]}</li><li>v{skill.version_number}</li><li>{skill.risk_class} risk</li><li>{skill.assigned_agents.length} assignment{skill.assigned_agents.length === 1 ? "" : "s"}</li></ul>
      </div>
    </div>
    <details className="skill-details">
      <summary>Inspect certified capability and exact bindings</summary>
      <div className="skill-detail-grid">
        <section><h4>Plain-language permissions</h4><ul className="permission-list"><li><CheckCircle2 /> Can read: {skill.permission_manifest.data_domains.map(readable).join(", ")}</li><li><FileCheck2 /> Can {canExecute ? "execute only the certified operation" : "propose or read"}: {skill.permission_manifest.operations.map(readable).join(", ")}</li><li><LockKeyhole /> Cannot access anything outside this reviewed manifest</li></ul></section>
        <section><h4>Certified runtime</h4><p>{skill.instructions}</p><p><strong>Integrations:</strong> {skill.integration_requirements.length ? skill.integration_requirements.map(readable).join(", ") : "None"}</p></section>
        <section><h4>Assigned workers</h4><ul>{skill.assigned_agents.map((agent) => <li key={`${agent.worker_code}-${agent.role_code}`}><strong>{readable(agent.worker_code)}</strong><small>{readable(agent.role_code)} · {agent.state}</small></li>)}</ul></section>
        <section><h4>Contract evidence</h4><dl><div><dt>Input</dt><dd><code>{skill.input_schema_ref}</code></dd></div><div><dt>Output</dt><dd><code>{skill.output_schema_ref}</code></dd></div><div><dt>Hash</dt><dd><code>{skill.content_hash}</code></dd></div></dl></section>
      </div>
    </details>
  </article>;
}

function SkillState({ icon, title, copy, action }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode }) {
  return <section className="domain-empty">{icon}<div><h2>{title}</h2><p>{copy}</p></div>{action}</section>;
}

function SkillLoading() {
  return <div className="skill-loading" aria-label="Loading Skill Library"><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></div>;
}
