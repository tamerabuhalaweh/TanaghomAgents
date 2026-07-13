"use client";

import {
  CheckCircle2,
  CircleAlert,
  CirclePause,
  Clock3,
  KeyRound,
  Link2,
  PlugZap,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

type Provider = "postiz" | "ghl";
type ConnectionStatus = "configured" | "connected" | "error" | "disconnected";

interface Channel {
  id: string;
  name: string;
  identifier: string;
  profile: string;
  disabled: boolean;
}

interface Connection {
  id: string;
  provider: Provider;
  status: ConnectionStatus;
  base_url: string;
  credential_kind: string;
  credential_mask: string | null;
  configuration: Record<string, string>;
  account_label: string | null;
  discovered_channels: Channel[];
  last_tested_at: string | null;
  last_test_status: "passed" | "failed" | null;
  last_error_code: string | null;
  updated_at: string;
}

interface ProviderRecord {
  provider: Provider;
  label: string;
  default_base_url: string;
  connection: Connection | null;
}

interface Mapping { channel: string; provider_integration_id: string; is_active: boolean }

type AutomationMode = "manual" | "automatic" | "paused";

interface AutomationStatus {
  mode: AutomationMode;
  changed_at: string | null;
  changed_by: { id: string; display_name: string } | null;
  emergency_stop: boolean;
  emergency_stop_reason: string;
  readiness: {
    runtime_ready: boolean;
    connection_ready: boolean;
    channel_mapping_ready: boolean;
    operations_clear: boolean;
    ready_for_automatic: boolean;
    blockers: string[];
  };
}

interface IntegrationsPayload {
  secure_storage_configured: boolean;
  providers: ProviderRecord[];
  postiz_mappings: Mapping[];
  postiz_automation: AutomationStatus;
}

const errorCopy: Record<string, string> = {
  credential_encryption_not_configured: "Secure credential storage is not configured on the server.",
  credential_value_invalid: "Enter a valid credential with at least eight characters.",
  integration_credential_rejected: "The provider rejected this credential. Rotate it and try again.",
  integration_base_url_invalid: "Enter the provider API base URL without credentials, query parameters, or fragments.",
  integration_base_url_not_allowed: "This API base URL is not on the server-approved provider allowlist.",
  integration_base_url_https_required: "Provider API connections require HTTPS.",
  integration_provider_unreachable: "Tanaghom could not reach the provider safely. Try again shortly.",
  integration_test_failed: "The provider connection test did not pass.",
  integration_channel_discovery_failed: "Tanaghom connected, but Postiz channel discovery did not pass.",
  ghl_location_id_required: "A valid GoHighLevel Location ID is required.",
  postiz_mapping_duplicate_channel: "Choose only one Postiz account for each Tanaghom channel.",
  automation_runtime_not_ready: "The protected background worker is not ready for automatic drafts.",
  automation_emergency_stopped: "Tanaghom operations have applied the emergency stop.",
  postiz_connection_not_ready: "Connect and test Postiz before enabling automatic drafts.",
  postiz_channel_mapping_not_ready: "Map at least one supported Postiz channel first.",
  indeterminate_postiz_operation: "Resolve the uncertain Postiz operation before enabling automation.",
};

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not tested";
}

function statusTone(status?: ConnectionStatus) {
  if (status === "connected") return "success" as const;
  if (status === "error") return "danger" as const;
  if (status === "configured") return "attention" as const;
  return "neutral" as const;
}

export function IntegrationsSettings() {
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [payload, setPayload] = useState<IntegrationsPayload | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await authenticatedFetch("/api/admin/integrations", { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("load_failed");
      setPayload(await response.json() as IntegrationsPayload);
      setState("ready");
    } catch { setState("error"); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <div className="page-stack integrations-page">
    <PageHeading
      title="Integrations"
      description="Connect customer-owned services without sharing credentials with developers or exposing them to agent workflows."
    />
    {state === "loading" ? <IntegrationsLoading /> : null}
    {state === "forbidden" ? <SettingsState icon={<ShieldCheck />} title="Admin access required" copy="Only a Tanaghom Admin can add, rotate, test, or disconnect customer integrations." /> : null}
    {state === "error" ? <SettingsState icon={<CircleAlert />} title="Integration settings unavailable" copy="Tanaghom could not load the protected settings record." action={<button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} /> Try again</button>} /> : null}
    {state === "ready" && payload ? <>
      <section className={`credential-safety ${payload.secure_storage_configured ? "" : "credential-safety-warning"}`}>
        <ShieldCheck size={20} />
        <div><strong>{payload.secure_storage_configured ? "Write-only credential storage is ready" : "Credential storage requires server setup"}</strong><p>{payload.secure_storage_configured ? "Saved secrets are encrypted before PostgreSQL, masked after saving, and never returned to this browser." : "An administrator must install the encryption key before customer credentials can be saved."}</p></div>
        <StatusPill tone={payload.secure_storage_configured ? "success" : "attention"}>{payload.secure_storage_configured ? "Protected" : "Setup required"}</StatusPill>
      </section>
      <div className="integration-list">
        {payload.providers.map((provider) => <ProviderPanel
          key={provider.provider}
          record={provider}
          storageReady={payload.secure_storage_configured}
          mappings={payload.postiz_mappings}
          onChanged={load}
        />)}
      </div>
      <PostizAutomationControl automation={payload.postiz_automation} onChanged={load} />
      <section className="integration-boundary">
        <KeyRound size={19} />
        <div><strong>Customer credentials stay outside n8n</strong><p>Agent workflows use a restricted Tanaghom gateway. Provider tokens are decrypted only for the authorized request and are excluded from execution history.</p></div>
      </section>
    </> : null}
  </div>;
}

const modeContent: Record<AutomationMode, { title: string; copy: string; icon: React.ReactNode }> = {
  manual: { title: "Manual only", copy: "An approved item moves only when a person selects Sync to Postiz.", icon: <Send size={18} /> },
  automatic: { title: "Automatic drafts", copy: "Newly approved, mapped content is queued for background draft creation.", icon: <Clock3 size={18} /> },
  paused: { title: "Paused", copy: "Stop new Postiz queueing and worker claims while preserving every record.", icon: <CirclePause size={18} /> },
};

const blockerCopy: Record<string, string> = {
  runtime_not_enabled: "Background worker activation is awaiting controlled deployment.",
  credential_vault_not_ready: "Credential vault is not ready.",
  worker_authentication_not_ready: "Worker authentication is not ready.",
  gateway_not_ready: "Restricted provider gateway is not ready.",
  platform_emergency_stop: "Platform emergency stop is active.",
  postiz_connection_not_ready: "Postiz connection has not passed verification.",
  postiz_channel_mapping_not_ready: "No active Postiz channel mapping exists.",
  indeterminate_postiz_operation: "An uncertain Postiz operation requires human review.",
};

function PostizAutomationControl({ automation, onChanged }: { automation: AutomationStatus; onChanged: () => Promise<void> }) {
  const [selected, setSelected] = useState<AutomationMode>(automation.mode);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => { setSelected(automation.mode); }, [automation.mode]);

  async function save() {
    setBusy(true); setFeedback("");
    try {
      const response = await authenticatedFetch("/api/admin/automation/postiz", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: selected }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "automation_update_failed");
      setFeedback(selected === "automatic"
        ? "Automatic draft queueing enabled. Publishing still requires a human in Postiz."
        : selected === "paused"
          ? "Postiz draft automation paused. Existing records were preserved."
          : "Manual-only draft synchronization restored.");
      await onChanged();
    } catch (error) {
      const code = error instanceof Error ? error.message : "automation_update_failed";
      setFeedback(errorCopy[code] || "Tanaghom could not update the automation policy.");
    } finally { setBusy(false); }
  }

  const changed = selected !== automation.mode;
  const automaticUnavailable = selected === "automatic" && !automation.readiness.ready_for_automatic;
  const statusTone = automation.emergency_stop || automation.mode === "paused" ? "attention" : automation.mode === "automatic" ? "success" : "neutral";

  return <section className="automation-control" aria-labelledby="postiz-automation-title">
    <header className="automation-control-header">
      <div><h2 id="postiz-automation-title">Postiz draft automation</h2><p>Choose when approved content may enter the draft-delivery queue. This control cannot publish content.</p></div>
      <StatusPill tone={statusTone}>{automation.emergency_stop ? "Platform stopped" : modeContent[automation.mode].title}</StatusPill>
    </header>
    <div className="automation-control-body">
      <div className="automation-modes" role="radiogroup" aria-label="Postiz draft automation mode">
        {(Object.keys(modeContent) as AutomationMode[]).map((mode) => {
          const content = modeContent[mode];
          const disabled = mode === "automatic" && !automation.readiness.ready_for_automatic && automation.mode !== "automatic";
          return <button
            key={mode}
            className={`automation-mode ${selected === mode ? "automation-mode-selected" : ""}`}
            type="button"
            role="radio"
            aria-checked={selected === mode}
            disabled={busy || disabled}
            onClick={() => { setSelected(mode); setFeedback(""); }}
          >
            <span className="automation-mode-icon">{content.icon}</span>
            <span><strong>{content.title}</strong><small>{content.copy}</small></span>
            <span className="automation-radio" aria-hidden="true" />
          </button>;
        })}
      </div>
      <aside className="automation-readiness" aria-label="Automatic draft readiness">
        <h3>Readiness</h3>
        <ul>
          <ReadinessItem ready={automation.readiness.runtime_ready}>Protected worker and gateway</ReadinessItem>
          <ReadinessItem ready={automation.readiness.connection_ready}>Verified Postiz connection</ReadinessItem>
          <ReadinessItem ready={automation.readiness.channel_mapping_ready}>Active channel mapping</ReadinessItem>
          <ReadinessItem ready={automation.readiness.operations_clear}>No uncertain operation</ReadinessItem>
        </ul>
        {automation.readiness.blockers.length ? <p className="readiness-blocker">{automation.emergency_stop ? automation.emergency_stop_reason : blockerCopy[automation.readiness.blockers[0]] || "Automatic drafts are not ready."}</p> : <p className="readiness-ready">All automatic-draft gates are ready.</p>}
        <p className="automation-history">{automation.changed_at ? `Last changed ${date(automation.changed_at)} by ${automation.changed_by?.display_name || "a Tanaghom Admin"}.` : "Using Tanaghom’s safe manual default."}</p>
      </aside>
    </div>
    <footer className="automation-control-footer">
      <div><ShieldCheck size={17} /><span><strong>Draft-only boundary</strong><small>Automatic means queue and create a Postiz draft—never publish.</small></span></div>
      <button className={selected === "paused" ? "danger-button" : "primary-button"} type="button" disabled={!changed || busy || automaticUnavailable} onClick={() => void save()}>{busy ? "Saving policy…" : selected === "automatic" ? "Enable automatic drafts" : selected === "paused" ? "Pause draft automation" : "Use manual only"}</button>
    </footer>
    {feedback ? <p className="integration-feedback" role="status" aria-live="polite">{feedback}</p> : null}
  </section>;
}

function ReadinessItem({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return <li className={ready ? "readiness-item-ready" : ""}>{ready ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}<span>{children}</span></li>;
}

function ProviderPanel({ record, storageReady, mappings, onChanged }: {
  record: ProviderRecord;
  storageReady: boolean;
  mappings: Mapping[];
  onChanged: () => Promise<void>;
}) {
  const connection = record.connection;
  const [editing, setEditing] = useState(!connection || connection.status === "disconnected");
  const [busy, setBusy] = useState<"save" | "test" | "disconnect" | "mapping" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [secret, setSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState(connection?.base_url || record.default_base_url);
  const [locationId, setLocationId] = useState(connection?.configuration.location_id || "");
  const [pipelineId, setPipelineId] = useState(connection?.configuration.pipeline_id || "");
  const [bookingLink, setBookingLink] = useState(connection?.configuration.booking_link || "");

  async function request(action: "save" | "test" | "disconnect") {
    setBusy(action); setFeedback("");
    try {
      const response = await authenticatedFetch(`/api/admin/integrations/${record.provider}${action === "test" ? "/test" : ""}`, {
        method: action === "disconnect" ? "DELETE" : action === "save" ? "PUT" : "POST",
        headers: action === "save" ? { "Content-Type": "application/json" } : undefined,
        body: action === "save" ? JSON.stringify({
          secret, base_url: baseUrl,
          configuration: record.provider === "ghl" ? { location_id: locationId, pipeline_id: pipelineId, booking_link: bookingLink } : {},
        }) : undefined,
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "request_failed");
      setSecret(""); setEditing(false); setConfirmDisconnect(false);
      setFeedback(action === "save" ? "Credential encrypted and saved. Test the connection before using it." : action === "test" ? "Connection verified with the provider." : "Credential destroyed and integration disconnected.");
      await onChanged();
    } catch (error) {
      const code = error instanceof Error ? error.message : "request_failed";
      setFeedback(errorCopy[code] || "Tanaghom could not complete this integration request.");
    } finally { setBusy(null); }
  }

  return <section className="integration-provider" aria-labelledby={`${record.provider}-title`}>
    <header className="integration-provider-header">
      <div className="provider-identity"><span><PlugZap size={19} /></span><div><h2 id={`${record.provider}-title`}>{record.label}</h2><p>{record.provider === "postiz" ? "Create human-approved social drafts and map connected channels." : "Route qualified leads and sales activity into the customer CRM."}</p></div></div>
      <StatusPill tone={statusTone(connection?.status)}>{connection?.status || "Not connected"}</StatusPill>
    </header>

    {connection && connection.status !== "disconnected" && !editing ? <div className="integration-summary">
      <dl>
        <div><dt>Account</dt><dd>{connection.account_label || "Awaiting connection test"}</dd></div>
        <div><dt>Credential</dt><dd>{connection.credential_mask}</dd></div>
        <div><dt>Last verified</dt><dd>{date(connection.last_tested_at)}</dd></div>
        <div><dt>Endpoint</dt><dd>{connection.base_url}</dd></div>
      </dl>
      <div className="integration-actions">
        <button className="secondary-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => void request("test")}><RefreshCw size={15} /> {busy === "test" ? "Testing…" : "Test connection"}</button>
        <button className="ghost-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => setEditing(true)}><KeyRound size={15} /> Rotate credential</button>
        {!confirmDisconnect ? <button className="text-danger-button compact-button" type="button" disabled={Boolean(busy)} onClick={() => setConfirmDisconnect(true)}><Trash2 size={15} /> Disconnect</button> : <div className="disconnect-confirm"><span>This destroys the saved credential.</span><button className="text-danger-button compact-button" type="button" onClick={() => void request("disconnect")} disabled={Boolean(busy)}>{busy === "disconnect" ? "Disconnecting…" : "Confirm disconnect"}</button><button className="ghost-button compact-button" type="button" onClick={() => setConfirmDisconnect(false)}>Cancel</button></div>}
      </div>
    </div> : null}

    {editing ? <form className="integration-form" onSubmit={(event) => { event.preventDefault(); void request("save"); }}>
      <div className="form-field"><label htmlFor={`${record.provider}-secret`}>{record.provider === "postiz" ? "Postiz API key or OAuth token" : "GoHighLevel private integration token"}</label><input id={`${record.provider}-secret`} type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} minLength={8} required disabled={!storageReady || Boolean(busy)} /><span className="field-help">Write-only: Tanaghom will never display this value again.</span></div>
      <div className="form-field"><label htmlFor={`${record.provider}-base-url`}>Approved API base URL</label><input id={`${record.provider}-base-url`} type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required disabled={!storageReady || Boolean(busy)} /><span className="field-help">{record.provider === "postiz" ? "Use the Public API base ending in /public/v1. Tanaghom adds /is-connected and /integrations safely." : "Only explicitly approved HTTPS provider base URLs are accepted."}</span></div>
      {record.provider === "ghl" ? <>
        <div className="form-field"><label htmlFor="ghl-location">Location ID</label><input id="ghl-location" value={locationId} onChange={(event) => setLocationId(event.target.value)} required disabled={!storageReady || Boolean(busy)} /></div>
        <div className="form-field"><label htmlFor="ghl-pipeline">Pipeline ID <span>Optional</span></label><input id="ghl-pipeline" value={pipelineId} onChange={(event) => setPipelineId(event.target.value)} disabled={!storageReady || Boolean(busy)} /></div>
        <div className="form-field"><label htmlFor="ghl-booking">Booking link <span>Optional</span></label><input id="ghl-booking" type="url" value={bookingLink} onChange={(event) => setBookingLink(event.target.value)} disabled={!storageReady || Boolean(busy)} /></div>
      </> : null}
      <div className="integration-form-actions">{connection ? <button className="ghost-button" type="button" onClick={() => setEditing(false)} disabled={Boolean(busy)}>Cancel</button> : null}<button className="primary-button" type="submit" disabled={!storageReady || Boolean(busy)}><ShieldCheck size={16} /> {busy === "save" ? "Encrypting…" : connection ? "Rotate and save" : "Encrypt and save"}</button></div>
    </form> : null}

    {record.provider === "postiz" && connection?.status === "connected" ? <PostizMappings channels={connection.discovered_channels} current={mappings} busy={busy === "mapping"} setBusy={setBusy} onChanged={onChanged} setFeedback={setFeedback} /> : null}
    {feedback ? <p className="integration-feedback" role="status" aria-live="polite">{feedback}</p> : null}
  </section>;
}

const providerToChannel: Record<string, string> = { instagram: "instagram", "instagram-standalone": "instagram", facebook: "facebook", linkedin: "linkedin", "linkedin-page": "linkedin", tiktok: "tiktok", youtube: "youtube" };

function PostizMappings({ channels, current, busy, setBusy, onChanged, setFeedback }: {
  channels: Channel[]; current: Mapping[]; busy: boolean;
  setBusy: (value: "mapping" | null) => void; onChanged: () => Promise<void>; setFeedback: (value: string) => void;
}) {
  const eligible = useMemo(() => channels.filter((channel) => !channel.disabled && providerToChannel[channel.identifier]), [channels]);
  const tanaghomChannels = [...new Set(eligible.map((channel) => providerToChannel[channel.identifier]))];
  const [selected, setSelected] = useState<Record<string, string>>(() => Object.fromEntries(current.map((mapping) => [mapping.channel, mapping.provider_integration_id])));

  async function save() {
    setBusy("mapping"); setFeedback("");
    try {
      const mappings = Object.entries(selected).filter(([, id]) => id).map(([channel, provider_integration_id]) => ({ channel, provider_integration_id }));
      const response = await authenticatedFetch("/api/admin/integrations/postiz/channels", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mappings }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "mapping_failed");
      setFeedback("Postiz channel mappings saved. No content was sent or published.");
      await onChanged();
    } catch (error) {
      const code = error instanceof Error ? error.message : "mapping_failed";
      setFeedback(errorCopy[code] || "Tanaghom could not save the channel mappings.");
    } finally { setBusy(null); }
  }

  return <div className="channel-mapping" aria-labelledby="postiz-channels-title">
    <div><h3 id="postiz-channels-title">Channel mapping</h3><p>Choose which Postiz account receives a Tanaghom draft for each channel. This does not enable publishing.</p></div>
    {tanaghomChannels.length ? <div className="channel-mapping-grid">{tanaghomChannels.map((channel) => <label key={channel}><span>{channel}</span><select value={selected[channel] || ""} onChange={(event) => setSelected((value) => ({ ...value, [channel]: event.target.value }))}><option value="">Not mapped</option>{eligible.filter((item) => providerToChannel[item.identifier] === channel).map((item) => <option key={item.id} value={item.id}>{item.name}{item.profile ? ` · ${item.profile}` : ""}</option>)}</select></label>)}</div> : <div className="channel-empty"><Link2 size={18} /><span><strong>No supported Postiz channels found</strong><small>Connect social accounts in Postiz, then test this connection again.</small></span></div>}
    <button className="secondary-button compact-button" type="button" disabled={busy || !tanaghomChannels.length} onClick={() => void save()}>{busy ? "Saving mappings…" : "Save channel mappings"}</button>
  </div>;
}

function SettingsState({ icon, title, copy, action }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode }) {
  return <section className="domain-empty">{icon}<div><h2>{title}</h2><p>{copy}</p></div>{action}</section>;
}

function IntegrationsLoading() {
  return <div className="integrations-loading" aria-label="Loading integration settings"><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></div>;
}
