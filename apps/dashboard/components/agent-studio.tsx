"use client";

import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  CopyPlus,
  Languages,
  LockKeyhole,
  PauseCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Unplug,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import type { Tone } from "@/data/fixtures";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";

type Lifecycle = "draft" | "validated" | "simulation" | "shadow" | "assisted" | "active" | "paused" | "retired";
type Language = "en" | "ar";
type Mode = "disabled" | "manual" | "shadow" | "assisted";
type Channel = "email" | "facebook" | "instagram" | "linkedin" | "live_chat" | "sms" | "tiktok" | "whatsapp" | "x" | "youtube";

interface AgentTemplate {
  code: string;
  name: string;
  description: string;
  responsibility: string;
  objective: string;
  recommended_skill_codes: string[];
  maximum_mode: Mode;
}

interface AvailableSkill {
  code: string;
  name: string;
  description: string;
  skill_class: string;
  skill_source: "platform" | "organization";
  skill_version_id: string;
  version_number: number;
  risk_class: string;
  side_effect_class: string;
  permission_manifest: {
    data_domains?: string[];
    operations?: string[];
    channels?: string[];
  };
  integration_requirements: string[];
}

interface Connection {
  connection_id: string;
  provider: "postiz" | "ghl";
  status: string;
  last_test_status: string | null;
  last_tested_at: string | null;
}

interface AvailableKnowledge {
  knowledge_key: string;
  title: string;
  category: string;
  language: "en" | "ar" | "und";
  version_number: number;
}

interface AgentSkill {
  skill_source: "platform" | "organization";
  platform_skill_version_id: string | null;
  organization_skill_version_id: string | null;
  operating_mode: Mode;
  approval_required: boolean;
  skill_code: string;
  skill_name: string;
  risk_class: string;
  side_effect_class: string;
}

interface AgentIntegration {
  connection_id: string;
  provider: "postiz" | "ghl";
  purpose: string;
  channels: Channel[];
  status: string;
  last_test_status: string | null;
}

interface AgentPolicy {
  business_timezone: string;
  business_hours: Array<{ day: number; start: string; end: string }>;
  allowed_channels: Channel[];
  consent_required: boolean;
  max_steps: number;
  max_tool_calls: number;
  max_retries: number;
  max_concurrency: number;
  max_runtime_seconds: number;
  max_tokens: number;
  max_daily_actions: number;
  max_actions_per_minute: number;
  max_follow_ups_per_contact: number;
  monthly_budget: string | number;
  allowed_record_types: string[];
  allowed_action_types: string[];
  approval_actions: string[];
  approval_roles: Array<"owner" | "reviewer">;
  approval_expiry_minutes: number;
  parameter_bound_approval: boolean;
  escalation_conditions: string[];
}

interface AgentVersion {
  agent_id: string;
  code: string;
  agent_version_id: string;
  version_number: number;
  lifecycle_state: Lifecycle;
  paused_from_state: Lifecycle | null;
  template_code: string | null;
  display_name: string;
  description: string;
  objective: string;
  responsibility: string;
  tone: string;
  brand_profile_key: string | null;
  languages: Language[];
  knowledge_keys: string[];
  content_hash: string;
  supersedes_version_id: string | null;
  created_at: string;
  validated_at: string | null;
  created_by_name: string;
  skills: AgentSkill[];
  integrations: AgentIntegration[];
  policy: AgentPolicy;
  scenarios: Array<{ code: string; language: Language; scenario_kind: string; result_state: string }>;
  audit_events: Array<{ event_type: string; actor_name: string; occurred_at: string }>;
  changed_fields: string[];
}

interface AgentStudioPayload {
  can_manage: boolean;
  templates: AgentTemplate[];
  available_skills: AvailableSkill[];
  available_knowledge: AvailableKnowledge[];
  connections: Connection[];
  agents: AgentVersion[];
  counts: { definitions: number; drafts: number; validated: number; running: number };
  safety: {
    automatic_mode_available: boolean;
    runtime_executor_available: boolean;
    provider_calls_from_studio: boolean;
    credentials_exposed_to_browser: boolean;
    mandatory_scenarios_per_language: number;
    next_gate: string;
  };
}

interface DraftSkill {
  skill_source: "platform" | "organization";
  skill_version_id: string;
  operating_mode: Mode;
  approval_required: boolean;
}

interface DraftState {
  code: string;
  template_code: string | null;
  display_name: string;
  description: string;
  objective: string;
  responsibility: string;
  tone: string;
  brand_profile_key: string;
  languages: Language[];
  knowledge_keys: string[];
  skills: DraftSkill[];
  integrations: string[];
  business_timezone: string;
  allowed_channels: Channel[];
  consent_required: boolean;
  max_steps: number;
  max_tool_calls: number;
  max_retries: number;
  max_concurrency: number;
  max_runtime_seconds: number;
  max_tokens: number;
  max_daily_actions: number;
  max_actions_per_minute: number;
  max_follow_ups_per_contact: number;
  monthly_budget: number;
  allowed_record_types: string;
  allowed_action_types: string;
  approval_actions: string;
  approval_roles: Array<"owner" | "reviewer">;
  approval_expiry_minutes: number;
  escalation_conditions: string;
  clone_source_version_id: string | null;
}

const channels: Channel[] = ["whatsapp", "email", "sms", "live_chat", "facebook", "instagram", "linkedin", "tiktok", "x", "youtube"];
const weekdays = [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" }));

function emptyDraft(): DraftState {
  return {
    code: "",
    template_code: null,
    display_name: "",
    description: "",
    objective: "",
    responsibility: "",
    tone: "Calm, direct, and evidence-based",
    brand_profile_key: "",
    languages: ["en", "ar"],
    knowledge_keys: [],
    skills: [],
    integrations: [],
    business_timezone: "Asia/Amman",
    allowed_channels: [],
    consent_required: true,
    max_steps: 8,
    max_tool_calls: 4,
    max_retries: 2,
    max_concurrency: 3,
    max_runtime_seconds: 300,
    max_tokens: 6000,
    max_daily_actions: 0,
    max_actions_per_minute: 10,
    max_follow_ups_per_contact: 2,
    monthly_budget: 0,
    allowed_record_types: "contact, conversation",
    allowed_action_types: "proposal.create",
    approval_actions: "provider.external_write",
    approval_roles: ["owner", "reviewer"],
    approval_expiry_minutes: 60,
    escalation_conditions: "Escalate when evidence is missing, policy conflicts, or customer intent is ambiguous.",
    clone_source_version_id: null,
  };
}

const lifecycleTone: Record<Lifecycle, Tone> = {
  draft: "neutral",
  validated: "working",
  simulation: "working",
  shadow: "attention",
  assisted: "attention",
  active: "success",
  paused: "danger",
  retired: "neutral",
};
const lifecycleOrder: Lifecycle[] = ["draft", "validated", "simulation", "shadow", "assisted", "active"];

function readable(value: string) {
  return value.replaceAll("_", " ").replaceAll(".", " · ");
}

function formatted(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "Not yet";
}

function tokens(value: string) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function requestMessage(code: string | undefined, fallback: string) {
  if (code === "agent_version_stale") return "A newer agent version now exists. Refresh before creating another revision.";
  if (code === "agent_knowledge_not_available") return "One selected knowledge version is no longer active or belongs to another workspace. Refresh the catalog.";
  if (code === "agent_integration_not_ready") return "A selected Skill, provider, or channel is incompatible or not ready. Review the integration mapping.";
  if (code === "agent_validation_failed") return "The draft contains an invalid or unsafe field. Review the highlighted contract values.";
  return fallback;
}

export function AgentStudio() {
  const [payload, setPayload] = useState<AgentStudioPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await authenticatedFetch("/api/admin/agents");
      if (response.status === 403) {
        setState("forbidden");
        return;
      }
      if (!response.ok) throw new Error("agent_studio_load_failed");
      setPayload(await response.json() as AgentStudioPayload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const latestVersions = useMemo(() => (payload?.agents || []).filter((version) =>
    !(payload?.agents || []).some((candidate) =>
      candidate.agent_id === version.agent_id && candidate.version_number > version.version_number),
  ), [payload]);

  function openNew() {
    setDraft(emptyDraft());
    setComposerOpen(true);
    setFeedback("");
  }

  function revise(version: AgentVersion) {
    setDraft({
      code: version.code,
      template_code: version.template_code,
      display_name: version.display_name,
      description: version.description,
      objective: version.objective,
      responsibility: version.responsibility,
      tone: version.tone,
      brand_profile_key: version.brand_profile_key || "",
      languages: version.languages,
      knowledge_keys: version.knowledge_keys,
      skills: version.skills.map((skill) => ({
        skill_source: skill.skill_source,
        skill_version_id: skill.platform_skill_version_id || skill.organization_skill_version_id || "",
        operating_mode: skill.operating_mode,
        approval_required: skill.approval_required,
      })),
      integrations: version.integrations.map((integration) => integration.connection_id),
      business_timezone: version.policy.business_timezone,
      allowed_channels: version.policy.allowed_channels,
      consent_required: version.policy.consent_required,
      max_steps: version.policy.max_steps,
      max_tool_calls: version.policy.max_tool_calls,
      max_retries: version.policy.max_retries,
      max_concurrency: version.policy.max_concurrency,
      max_runtime_seconds: version.policy.max_runtime_seconds,
      max_tokens: version.policy.max_tokens,
      max_daily_actions: version.policy.max_daily_actions,
      max_actions_per_minute: version.policy.max_actions_per_minute,
      max_follow_ups_per_contact: version.policy.max_follow_ups_per_contact,
      monthly_budget: Number(version.policy.monthly_budget),
      allowed_record_types: version.policy.allowed_record_types.join(", "),
      allowed_action_types: version.policy.allowed_action_types.join(", "),
      approval_actions: version.policy.approval_actions.join(", "),
      approval_roles: version.policy.approval_roles,
      approval_expiry_minutes: version.policy.approval_expiry_minutes,
      escalation_conditions: version.policy.escalation_conditions.join("\n"),
      clone_source_version_id: version.agent_version_id,
    });
    setComposerOpen(true);
    setFeedback("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <div className="page-stack agent-studio-page">
    <PageHeading
      title="Agent Studio"
      description="Create governed business agents by combining approved Skills, customer-managed integrations, clear rules, and an immutable rollout version."
      actions={payload?.can_manage
        ? <button className="primary-button" type="button" onClick={() => composerOpen ? setComposerOpen(false) : openNew()}>
          {composerOpen ? <X size={17} /> : <Plus size={17} />}
          {composerOpen ? "Close studio" : "Create agent"}
        </button>
        : undefined}
    />

    {state === "loading" ? <StudioLoading /> : null}
    {state === "forbidden" ? <StudioState icon={<LockKeyhole />} title="Agent Studio is restricted" copy="Only accepted workspace members may inspect governed agent versions." /> : null}
    {state === "error" ? <StudioState icon={<AlertTriangle />} title="Agent Studio could not load" copy="No saved version was changed. Retry the protected read." action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={16} /> Retry</button>} /> : null}

    {state === "ready" && payload ? <>
      <section className="studio-safety" aria-label="Agent Studio safety boundary">
        <ShieldCheck size={20} aria-hidden="true" />
        <div>
          <strong>Configuration, not uncontrolled automation</strong>
          <p>Studio can create and validate immutable agent versions. It cannot expose credentials, edit n8n, call a provider, or activate a runtime. Simulation and rollout remain blocked until the shared executor and certification gates pass.</p>
        </div>
        <StatusPill tone="attention">Runtime gated</StatusPill>
      </section>

      <section className="studio-summary" aria-label="Organization agent summary">
        <dl>
          <div><dt>Organization agents</dt><dd>{payload.counts.definitions}</dd></div>
          <div><dt>Draft versions</dt><dd>{payload.counts.drafts}</dd></div>
          <div><dt>Validated</dt><dd>{payload.counts.validated}</dd></div>
          <div><dt>Running</dt><dd>{payload.counts.running}</dd></div>
        </dl>
        <div><CircleGauge size={18} /><span><strong>Next rollout gate</strong><small>{payload.safety.next_gate}</small></span></div>
      </section>

      {composerOpen && payload.can_manage
        ? <AgentComposer payload={payload} draft={draft} setDraft={setDraft} onCreated={async () => {
          setComposerOpen(false);
          setDraft(emptyDraft());
          setFeedback("Immutable agent draft created. Validate it when the exact Skills, integrations, and limits are correct.");
          await load();
        }} />
        : null}

      <section className="studio-catalog">
        <header>
          <div><h2>Organization agent versions</h2><p>Latest versions are shown first. System agents remain protected in the operational Agents registry.</p></div>
          <StatusPill tone="neutral">{latestVersions.length} latest</StatusPill>
        </header>
        {latestVersions.length
          ? <div className="studio-agent-list">{latestVersions.map((version) =>
            <AgentVersionRow key={version.agent_version_id} version={version} canManage={payload.can_manage} onRevise={() => revise(version)} onChanged={async (message) => {
              setFeedback(message);
              await load();
            }} />)}
          </div>
          : <StudioState icon={<Bot />} title="No organization agents yet" copy="Start from a reviewed template or a safe empty definition. Creating a draft does not start an agent." action={payload.can_manage ? <button className="primary-button" type="button" onClick={openNew}><Plus size={16} /> Create first agent</button> : undefined} />}
      </section>
      {feedback ? <p className="integration-feedback" role="status" aria-live="polite">{feedback}</p> : null}
    </> : null}
  </div>;
}

function AgentComposer({ payload, draft, setDraft, onCreated }: {
  payload: AgentStudioPayload;
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  onCreated: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedSkillIds = new Set(draft.skills.map((skill) => skill.skill_version_id));
  const direction = draft.languages.length === 1 && draft.languages[0] === "ar" ? "rtl" : "ltr";
  const requiredProviders = new Set(draft.skills.flatMap((binding) => {
    const skill = payload.available_skills.find((candidate) => candidate.skill_version_id === binding.skill_version_id);
    return (skill?.integration_requirements || []).flatMap((requirement) =>
      requirement === "ghl_private_gateway" ? ["ghl"] : requirement === "postiz_private_gateway" ? ["postiz"] : []);
  }));
  const selectedProviders = new Set(draft.integrations.flatMap((id) => {
    const provider = payload.connections.find((connection) => connection.connection_id === id)?.provider;
    return provider ? [provider] : [];
  }));
  const missingProviders = [...requiredProviders].filter((provider) => !selectedProviders.has(provider as "ghl" | "postiz"));
  const integrationWithoutChannel = draft.integrations.some((id) => {
    const provider = payload.connections.find((connection) => connection.connection_id === id)?.provider;
    return provider === "ghl"
      ? !draft.allowed_channels.some((channel) => ["email", "live_chat", "sms", "whatsapp"].includes(channel))
      : provider === "postiz"
        ? !draft.allowed_channels.some((channel) => ["facebook", "instagram", "linkedin", "tiktok", "x", "youtube"].includes(channel))
        : true;
  });

  function update<Key extends keyof DraftState>(key: Key, value: DraftState[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function chooseTemplate(template: AgentTemplate) {
    const selected = payload.available_skills
      .filter((skill) => template.recommended_skill_codes.includes(skill.code))
      .map((skill): DraftSkill => ({
        skill_source: skill.skill_source,
        skill_version_id: skill.skill_version_id,
        operating_mode: skill.side_effect_class === "external_write" ? "manual" : "shadow",
        approval_required: true,
      }));
    setDraft((current) => ({
      ...current,
      template_code: template.code,
      code: current.clone_source_version_id ? current.code : template.code,
      display_name: current.clone_source_version_id ? current.display_name : template.name,
      description: template.description,
      responsibility: template.responsibility,
      objective: template.objective,
      skills: selected,
    }));
  }

  function toggleSkill(skill: AvailableSkill) {
    setDraft((current) => ({
      ...current,
      skills: current.skills.some((item) => item.skill_version_id === skill.skill_version_id)
        ? current.skills.filter((item) => item.skill_version_id !== skill.skill_version_id)
        : [...current.skills, {
          skill_source: skill.skill_source,
          skill_version_id: skill.skill_version_id,
          operating_mode: skill.side_effect_class === "external_write" ? "manual" : "shadow",
          approval_required: true,
        }],
    }));
  }

  function updateSkill(id: string, patch: Partial<DraftSkill>) {
    setDraft((current) => ({
      ...current,
      skills: current.skills.map((skill) => skill.skill_version_id === id ? { ...skill, ...patch } : skill),
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const integrations = draft.integrations.map((id) => {
        const connection = payload.connections.find((candidate) => candidate.connection_id === id)!;
        return {
          connection_id: id,
          provider: connection.provider,
          purpose: connection.provider === "ghl"
            ? "Use the customer-managed CRM connection only for approved governed actions."
            : "Use the customer-managed publishing connection only for approved draft operations.",
          channels: draft.allowed_channels.filter((channel) => connection.provider === "ghl"
            ? ["email", "live_chat", "sms", "whatsapp"].includes(channel)
            : ["facebook", "instagram", "linkedin", "tiktok", "x", "youtube"].includes(channel)),
        };
      });
      const response = await authenticatedFetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: draft.code,
          template_code: draft.template_code,
          display_name: draft.display_name,
          description: draft.description,
          objective: draft.objective,
          responsibility: draft.responsibility,
          tone: draft.tone,
          brand_profile_key: draft.brand_profile_key || null,
          languages: draft.languages,
          knowledge_keys: draft.knowledge_keys,
          skills: draft.skills.map((skill) => ({ ...skill, constraints: {} })),
          integrations,
          policy: {
            business_timezone: draft.business_timezone,
            business_hours: weekdays,
            allowed_channels: draft.allowed_channels,
            consent_required: draft.consent_required,
            max_steps: draft.max_steps,
            max_tool_calls: draft.max_tool_calls,
            max_retries: draft.max_retries,
            max_concurrency: draft.max_concurrency,
            max_runtime_seconds: draft.max_runtime_seconds,
            max_tokens: draft.max_tokens,
            max_daily_actions: draft.max_daily_actions,
            max_actions_per_minute: draft.max_actions_per_minute,
            max_follow_ups_per_contact: draft.max_follow_ups_per_contact,
            monthly_budget: draft.monthly_budget,
            allowed_record_types: tokens(draft.allowed_record_types),
            allowed_action_types: tokens(draft.allowed_action_types),
            approval_actions: tokens(draft.approval_actions),
            approval_roles: draft.approval_roles,
            approval_expiry_minutes: draft.approval_expiry_minutes,
            parameter_bound_approval: true,
            escalation_conditions: draft.escalation_conditions.split("\n").map((item) => item.trim()).filter(Boolean),
          },
          clone_source_version_id: draft.clone_source_version_id,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; details?: Array<{ message: string }> };
      if (!response.ok) throw new Error(body.details?.[0]?.message || requestMessage(body.error, "The agent draft was rejected by the governance boundary."));
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The agent draft could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="studio-composer" onSubmit={(event) => void submit(event)}>
    <header>
      <div>
        <h2>{draft.clone_source_version_id ? `Create the next version of ${draft.display_name}` : "Compose a governed agent"}</h2>
        <p>Every save is immutable. A later change creates a new version and returns to validation.</p>
      </div>
      <StatusPill tone="neutral">Draft only</StatusPill>
    </header>

    <section className="studio-step">
      <div className="studio-step-heading"><span>1</span><div><h3>Choose a safe starting point</h3><p>Templates suggest identity and Skills. They never include credentials or activation authority.</p></div></div>
      <div className="studio-template-list">
        {payload.templates.map((template) => <button key={template.code} className={draft.template_code === template.code ? "studio-template-selected" : ""} type="button" onClick={() => chooseTemplate(template)}>
          <span><Sparkles size={17} /></span><strong>{template.name}</strong><p>{template.description}</p><small>{template.recommended_skill_codes.length} recommended Skills · maximum {template.maximum_mode}</small>
          {draft.template_code === template.code ? <Check size={16} aria-label="Selected" /> : <ChevronRight size={16} aria-hidden="true" />}
        </button>)}
      </div>
    </section>

    <section className="studio-step">
      <div className="studio-step-heading"><span>2</span><div><h3>Identity and measurable outcome</h3><p>Make the responsibility narrow enough that a human can judge success.</p></div></div>
      <div className="studio-form-grid">
        <label><span>Stable code</span><input value={draft.code} onChange={(event) => update("code", event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} pattern="[a-z][a-z0-9_]{2,79}" disabled={Boolean(draft.clone_source_version_id)} required /><small>Cannot change after the first version.</small></label>
        <label><span>Display name</span><input dir={direction} value={draft.display_name} onChange={(event) => update("display_name", event.target.value)} minLength={3} maxLength={120} required /></label>
        <label className="wide"><span>Description</span><textarea dir={direction} value={draft.description} onChange={(event) => update("description", event.target.value)} minLength={20} maxLength={1000} rows={3} required /></label>
        <label className="wide"><span>Measurable objective</span><textarea dir={direction} value={draft.objective} onChange={(event) => update("objective", event.target.value)} minLength={10} maxLength={500} rows={2} required /></label>
        <label className="wide"><span>Business responsibility</span><textarea dir={direction} value={draft.responsibility} onChange={(event) => update("responsibility", event.target.value)} minLength={20} maxLength={1000} rows={3} required /></label>
        <label><span>Tone</span><input dir={direction} value={draft.tone} onChange={(event) => update("tone", event.target.value)} minLength={3} maxLength={120} required /></label>
        <label><span>Approved brand profile <em>Optional</em></span><input value={draft.brand_profile_key} onChange={(event) => update("brand_profile_key", event.target.value.toLowerCase())} pattern="brand/[a-z0-9][a-z0-9_./-]{2,199}" placeholder="brand/tanaghom" /><small>A governed key—not pasted brand instructions.</small></label>
        <fieldset><legend>Languages</legend>{(["en", "ar"] as const).map((language) => <label key={language}><input type="checkbox" checked={draft.languages.includes(language)} onChange={(event) => update("languages", event.target.checked ? [...new Set([...draft.languages, language])] : draft.languages.filter((item) => item !== language))} /> {language === "en" ? "English" : "Arabic"}</label>)}</fieldset>
        <fieldset className="wide channel-options"><legend>Active knowledge versions <em>Optional</em></legend>
          {payload.available_knowledge.length ? payload.available_knowledge.map((knowledge) => <label key={knowledge.knowledge_key}>
            <input type="checkbox" checked={draft.knowledge_keys.includes(knowledge.knowledge_key)} onChange={(event) => update("knowledge_keys", event.target.checked ? [...draft.knowledge_keys, knowledge.knowledge_key] : draft.knowledge_keys.filter((key) => key !== knowledge.knowledge_key))} />
            {knowledge.title} · v{knowledge.version_number} · {knowledge.language.toUpperCase()}
          </label>) : <small>No active organization knowledge version is available. Add and activate knowledge before binding it.</small>}
        </fieldset>
      </div>
    </section>

    <section className="studio-step">
      <div className="studio-step-heading"><span>3</span><div><h3>Assign exact Skill versions</h3><p>Choose only reviewed capabilities. Automatic mode is intentionally unavailable.</p></div></div>
      <div className="studio-skill-picker">
        {payload.available_skills.map((skill) => {
          const selected = draft.skills.find((item) => item.skill_version_id === skill.skill_version_id);
          return <article key={skill.skill_version_id} className={selected ? "studio-skill-selected" : ""}>
            <label className="studio-skill-check"><input type="checkbox" checked={Boolean(selected)} onChange={() => toggleSkill(skill)} /><span><strong>{skill.name}</strong><small>{skill.skill_source} · v{skill.version_number} · {readable(skill.side_effect_class)} · {skill.risk_class} risk</small></span></label>
            <p>{skill.description}</p>
            {selected ? <div className="studio-skill-controls">
              <label><span>Mode</span><select value={selected.operating_mode} onChange={(event) => updateSkill(skill.skill_version_id, { operating_mode: event.target.value as Mode, approval_required: event.target.value === "assisted" ? true : selected.approval_required })}>
                <option value="disabled">Disabled</option><option value="manual">Manual</option><option value="shadow">Shadow</option><option value="assisted">Assisted</option>
              </select></label>
              <label><input type="checkbox" checked={selected.approval_required} disabled={selected.operating_mode === "assisted"} onChange={(event) => updateSkill(skill.skill_version_id, { approval_required: event.target.checked })} /> Human approval required</label>
            </div> : null}
          </article>;
        })}
      </div>
      {!selectedSkillIds.size ? <p className="studio-inline-warning"><AlertTriangle size={16} /> Select at least one exact Skill version.</p> : null}
    </section>

    <section className="studio-step">
      <div className="studio-step-heading"><span>4</span><div><h3>Bind customer-managed integrations</h3><p>The browser sees readiness metadata only. Credentials stay inside the private gateway.</p></div></div>
      {payload.connections.length ? <div className="studio-connection-list">{payload.connections.map((connection) => <label key={connection.connection_id}>
        <input type="checkbox" checked={draft.integrations.includes(connection.connection_id)} onChange={(event) => update("integrations", event.target.checked ? [...draft.integrations, connection.connection_id] : draft.integrations.filter((id) => id !== connection.connection_id))} />
        <span><strong>{connection.provider === "ghl" ? "GoHighLevel" : "Postiz"}</strong><small>{readable(connection.status)} · test {readable(connection.last_test_status || "not_run")}</small></span>
        <StatusPill tone={connection.last_test_status === "passed" ? "success" : "attention"}>{connection.last_test_status === "passed" ? "Verified" : "Not verified"}</StatusPill>
      </label>)}</div> : <div className="studio-connection-empty"><Unplug size={19} /><div><strong>No customer integrations available</strong><p>You can still draft agents that use no provider Skill. Provider-dependent validation will remain blocked honestly.</p></div></div>}
      {missingProviders.length ? <p className="studio-inline-warning"><AlertTriangle size={16} /> Selected Skills require: {missingProviders.map(readable).join(", ")}.</p> : null}
      {integrationWithoutChannel ? <p className="studio-inline-warning"><AlertTriangle size={16} /> Every selected integration needs at least one compatible allowed channel in the policy below.</p> : null}
    </section>

    <section className="studio-step">
      <div className="studio-step-heading"><span>5</span><div><h3>Set policy, approvals, and hard limits</h3><p>Platform maximums always override these organization limits.</p></div></div>
      <div className="studio-form-grid limit-grid">
        <label><span>Timezone</span><input value={draft.business_timezone} onChange={(event) => update("business_timezone", event.target.value)} placeholder="Asia/Amman" required /></label>
        <label><span>Monthly budget limit</span><input type="number" min={0} max={1000000} step="0.01" value={draft.monthly_budget} onChange={(event) => update("monthly_budget", Number(event.target.value))} /></label>
        <label><span>Maximum steps</span><input type="number" min={1} max={20} value={draft.max_steps} onChange={(event) => update("max_steps", Number(event.target.value))} /></label>
        <label><span>Maximum tool calls</span><input type="number" min={0} max={20} value={draft.max_tool_calls} onChange={(event) => update("max_tool_calls", Number(event.target.value))} /></label>
        <label><span>Maximum retries</span><input type="number" min={0} max={5} value={draft.max_retries} onChange={(event) => update("max_retries", Number(event.target.value))} /></label>
        <label><span>Maximum concurrency</span><input type="number" min={1} max={20} value={draft.max_concurrency} onChange={(event) => update("max_concurrency", Number(event.target.value))} /></label>
        <label><span>Runtime seconds</span><input type="number" min={30} max={1800} value={draft.max_runtime_seconds} onChange={(event) => update("max_runtime_seconds", Number(event.target.value))} /></label>
        <label><span>Token ceiling</span><input type="number" min={100} max={32000} value={draft.max_tokens} onChange={(event) => update("max_tokens", Number(event.target.value))} /></label>
        <label><span>Daily external-action ceiling</span><input type="number" min={0} max={1000} value={draft.max_daily_actions} onChange={(event) => update("max_daily_actions", Number(event.target.value))} /><small>Keep zero when the agent must never act externally.</small></label>
        <label><span>Actions per minute</span><input type="number" min={0} max={100} value={draft.max_actions_per_minute} onChange={(event) => update("max_actions_per_minute", Number(event.target.value))} /></label>
        <label><span>Follow-ups per contact</span><input type="number" min={0} max={20} value={draft.max_follow_ups_per_contact} onChange={(event) => update("max_follow_ups_per_contact", Number(event.target.value))} /></label>
        <label className="checkbox-control"><input type="checkbox" checked={draft.consent_required} onChange={(event) => update("consent_required", event.target.checked)} /><span><strong>Require consent</strong><small>Contactability remains a hard policy check.</small></span></label>
        <fieldset className="wide channel-options"><legend>Allowed channels</legend>{channels.map((channel) => <label key={channel}><input type="checkbox" checked={draft.allowed_channels.includes(channel)} onChange={(event) => update("allowed_channels", event.target.checked ? [...draft.allowed_channels, channel] : draft.allowed_channels.filter((item) => item !== channel))} /> {readable(channel)}</label>)}</fieldset>
        <label className="wide"><span>Allowed record types</span><textarea value={draft.allowed_record_types} onChange={(event) => update("allowed_record_types", event.target.value)} rows={2} /><small>Examples: contact, conversation, campaign.</small></label>
        <label className="wide"><span>Allowed action types</span><textarea value={draft.allowed_action_types} onChange={(event) => update("allowed_action_types", event.target.value)} rows={2} /><small>Contract tokens only. These do not grant runtime authority by themselves.</small></label>
        <label className="wide"><span>Actions requiring approval</span><textarea value={draft.approval_actions} onChange={(event) => update("approval_actions", event.target.value)} rows={2} /><small>Safe contract tokens, comma or line separated.</small></label>
        <fieldset><legend>Eligible approvers</legend>{(["owner", "reviewer"] as const).map((role) => <label key={role}><input type="checkbox" checked={draft.approval_roles.includes(role)} onChange={(event) => update("approval_roles", event.target.checked ? [...new Set([...draft.approval_roles, role])] : draft.approval_roles.filter((item) => item !== role))} /> {role === "owner" ? "Admin" : "Reviewer"}</label>)}</fieldset>
        <label><span>Approval expires after</span><input type="number" min={5} max={10080} value={draft.approval_expiry_minutes} onChange={(event) => update("approval_expiry_minutes", Number(event.target.value))} /><small>Minutes; every approval is bound to the exact proposed parameters.</small></label>
        <label className="wide"><span>Escalate when</span><textarea dir={direction} value={draft.escalation_conditions} onChange={(event) => update("escalation_conditions", event.target.value)} minLength={10} rows={3} required /></label>
      </div>
    </section>

    <section className="studio-step studio-review-step">
      <div className="studio-step-heading"><span>6</span><div><h3>Review the rollout contract</h3><p>Studio prepares mandatory tests now; the certification phase must run and pass them later.</p></div></div>
      <div className="studio-review-grid">
        <div><Languages size={18} /><span><strong>{draft.languages.length * 7} safety scenarios</strong><small>Success, refusal, escalation, injection, provider failure, duplicate retry, and emergency stop for each language.</small></span></div>
        <div><LockKeyhole size={18} /><span><strong>Credentials remain private</strong><small>Only connection identifiers and readiness metadata are bound.</small></span></div>
        <div><PauseCircle size={18} /><span><strong>No activation on save</strong><small>The new version stays Draft; validation is a separate owner decision.</small></span></div>
        <div><ShieldCheck size={18} /><span><strong>Automatic mode unavailable</strong><small>Later runtime and certification work must earn any broader autonomy.</small></span></div>
      </div>
    </section>

    <footer>
      <div>{error ? <p role="alert">{error}</p> : <p>Creating this draft makes no provider, Gemma, n8n, or runtime call.</p>}</div>
      <button className="primary-button" type="submit" disabled={busy || !draft.languages.length || !draft.skills.length || !draft.approval_roles.length || missingProviders.length > 0 || integrationWithoutChannel}>{busy ? "Creating immutable draft…" : draft.clone_source_version_id ? "Create next draft version" : "Create immutable draft"}</button>
    </footer>
  </form>;
}

function AgentVersionRow({ version, canManage, onRevise, onChanged }: {
  version: AgentVersion;
  canManage: boolean;
  onRevise: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const scenarioPassed = version.scenarios.filter((scenario) => scenario.result_state === "passed").length;
  const canRead = version.skills.flatMap((skill) => skill.skill_name).length > 0;
  const canExecute = version.skills.some((skill) => ["internal_write", "external_write"].includes(skill.side_effect_class));

  async function transition(action: "validate" | "pause" | "resume" | "retire") {
    setBusy(action);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/admin/agents/${version.agent_version_id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(requestMessage(result.error, "The lifecycle request was rejected. Review the exact Skills, integrations, limits, and current state."));
      await onChanged(action === "validate"
        ? "Agent version validated. Simulation remains blocked until the shared runtime and mandatory tests are certified."
        : action === "retire"
          ? "Agent version retired. Historical configuration and audit evidence remain available."
          : action === "pause"
            ? "Agent version paused. New claims are blocked while evidence is preserved."
            : "Agent version returned to its prior governed rollout state.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lifecycle request failed.");
    } finally {
      setBusy("");
    }
  }

  return <article className="studio-agent-row">
    <header>
      <span className="studio-agent-mark"><Bot size={18} /></span>
      <div><div className="studio-agent-title"><h3>{version.display_name}</h3><StatusPill tone={lifecycleTone[version.lifecycle_state]}>{readable(version.lifecycle_state)}</StatusPill></div><p>{version.description}</p><ul><li>{version.code}</li><li>v{version.version_number}</li><li>{version.languages.map((language) => language === "ar" ? "Arabic" : "English").join(" + ")}</li><li>{version.skills.length} Skills</li></ul></div>
      {canManage ? <div className="studio-agent-actions">
        {version.lifecycle_state === "draft" ? <button className="primary-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void transition("validate")}><CheckCircle2 size={15} /> {busy === "validate" ? "Validating…" : "Validate"}</button> : null}
        {["shadow", "assisted", "active"].includes(version.lifecycle_state) ? <button className="secondary-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void transition("pause")}><PauseCircle size={15} /> Pause</button> : null}
        {version.lifecycle_state === "paused" ? <button className="secondary-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void transition("resume")}><RefreshCw size={15} /> Resume</button> : null}
        <button className="secondary-button compact-button" type="button" onClick={onRevise}><CopyPlus size={15} /> New version</button>
        {version.lifecycle_state !== "retired" ? <button className="ghost-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void transition("retire")}>Retire</button> : null}
      </div> : null}
    </header>

    <div className="studio-rollout" aria-label={`${version.display_name} rollout`}>
      {lifecycleOrder.map((stage, index) => <div key={stage} className={stage === version.lifecycle_state ? "studio-rollout-current" : lifecycleOrder.indexOf(version.lifecycle_state) > index ? "studio-rollout-complete" : ""}>
        <span>{stage === version.lifecycle_state ? <CircleGauge size={14} /> : lifecycleOrder.indexOf(version.lifecycle_state) > index ? <Check size={14} /> : index + 1}</span><small>{readable(stage)}</small>
      </div>)}
    </div>

    <div className="studio-capability-summary">
      <div><strong>Can read</strong><span>{canRead ? "Only assigned Skill data domains and approved knowledge keys." : "No data capability is assigned."}</span></div>
      <div><strong>Can propose</strong><span>{version.skills.some((skill) => ["proposal_only", "read_only"].includes(skill.side_effect_class)) ? "Only within pinned Skill contracts and current mode." : "No proposal capability is assigned."}</span></div>
      <div><strong>Can execute</strong><span>{canExecute ? "Only after runtime policy and exact human approval; currently inactive." : "No write capability is assigned."}</span></div>
      <div><strong>Can never do</strong><span>View credentials, edit n8n, exceed platform limits, or authorize itself.</span></div>
    </div>

    <details className="studio-agent-details">
      <summary>Inspect version, Skills, policy, tests, and history</summary>
      <div className="studio-detail-grid">
        <section><h4>Outcome and responsibility</h4><p><strong>Objective:</strong> {version.objective}</p><p><strong>Responsibility:</strong> {version.responsibility}</p><p><strong>Tone:</strong> {version.tone}</p><p><strong>Brand:</strong> {version.brand_profile_key || "No governed brand profile"}</p><p><strong>Knowledge:</strong> {version.knowledge_keys.join(", ") || "No knowledge version bound"}</p></section>
        <section><h4>Exact Skill assignments</h4><ul>{version.skills.map((skill) => <li key={skill.platform_skill_version_id || skill.organization_skill_version_id}><strong>{skill.skill_name}</strong><small>{skill.skill_source} · {readable(skill.operating_mode)} · approval {skill.approval_required ? "required" : "not required"}</small></li>)}</ul></section>
        <section><h4>Integrations and channels</h4>{version.integrations.length ? <ul>{version.integrations.map((integration) => <li key={integration.connection_id}><strong>{integration.provider === "ghl" ? "GoHighLevel" : "Postiz"}</strong><small>{readable(integration.status)} · {integration.channels.map(readable).join(", ") || "no channel"}</small></li>)}</ul> : <p>No provider connection is bound to this version.</p>}</section>
        <section><h4>Hard limits</h4><dl><div><dt>Steps / tools</dt><dd>{version.policy.max_steps} / {version.policy.max_tool_calls}</dd></div><div><dt>Retries / concurrency</dt><dd>{version.policy.max_retries} / {version.policy.max_concurrency}</dd></div><div><dt>Runtime / tokens</dt><dd>{version.policy.max_runtime_seconds}s / {version.policy.max_tokens}</dd></div><div><dt>Daily / per minute</dt><dd>{version.policy.max_daily_actions} / {version.policy.max_actions_per_minute}</dd></div><div><dt>Follow-ups</dt><dd>{version.policy.max_follow_ups_per_contact} per contact</dd></div></dl></section>
        <section><h4>Approval matrix</h4><p><strong>Actions:</strong> {version.policy.approval_actions.map(readable).join(", ") || "None"}</p><p><strong>Eligible:</strong> {version.policy.approval_roles.map(readable).join(", ")}</p><p><strong>Expiry:</strong> {version.policy.approval_expiry_minutes} minutes</p><p>Review is bound to exact proposed parameters: {version.policy.parameter_bound_approval ? "required" : "not configured"}.</p></section>
        <section><h4>Runtime activity</h4><p>Current jobs: 0. Skill invocations: 0. Open approvals: 0. Runtime metrics are unavailable because this version has no certified executor.</p></section>
        <section><h4>Mandatory certification</h4><p>{scenarioPassed} of {version.scenarios.length} scenarios passed. Structural definitions exist; execution evidence is owned by Phase 7F.</p><ul>{version.languages.map((language) => <li key={language}><strong>{language === "ar" ? "Arabic" : "English"}</strong><small>{version.scenarios.filter((scenario) => scenario.language === language).length} prepared · {version.scenarios.filter((scenario) => scenario.language === language && scenario.result_state === "passed").length} passed</small></li>)}</ul></section>
        <section><h4>Immutable evidence</h4><dl><div><dt>Content hash</dt><dd><code>{version.content_hash}</code></dd></div><div><dt>Created</dt><dd>{formatted(version.created_at)} by {version.created_by_name}</dd></div><div><dt>Validated</dt><dd>{formatted(version.validated_at)}</dd></div><div><dt>Changed from prior version</dt><dd>{version.changed_fields.map(readable).join(", ")}</dd></div></dl></section>
        <section><h4>Rollout blocker</h4><p>{version.lifecycle_state === "draft" ? "Owner validation is the next available transition." : version.lifecycle_state === "validated" ? "The shared policy-resolved runtime and mandatory simulation evidence are not yet certified." : "This state remains governed by platform readiness, emergency stops, and evidence expiry."}</p></section>
        <section><h4>Audit history</h4>{version.audit_events.length ? <ul>{version.audit_events.map((event, index) => <li key={`${event.occurred_at}-${index}`}><strong>{readable(event.event_type)}</strong><small>{event.actor_name} · {formatted(event.occurred_at)}</small></li>)}</ul> : <p>No audit event was returned.</p>}</section>
      </div>
    </details>
    {error ? <p className="studio-row-error" role="alert">{error}</p> : null}
  </article>;
}

function StudioState({ icon, title, copy, action }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode }) {
  return <section className="studio-state">{icon}<div><h2>{title}</h2><p>{copy}</p></div>{action}</section>;
}

function StudioLoading() {
  return <div className="studio-loading" aria-label="Loading Agent Studio"><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></div>;
}
