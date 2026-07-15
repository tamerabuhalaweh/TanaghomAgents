"use client";

import { BellRing, CircleAlert, Hash, Mail, MessageCircle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "./page-heading";
import { SettingsNavigation } from "./settings-navigation";
import { StatusPill } from "./status-pill";

type Channel = "email" | "slack" | "whatsapp";
type Severity = "info" | "warning" | "error" | "critical";

interface Destination {
  id: string; channel: Channel; label: string; status: string; target_mask: string;
  minimum_severity: Severity; event_types: string[]; updated_at: string;
}
interface Definition { channel: Channel; label: string; target_label: string; target_example: string; credential_source: string }
interface EventDefinition { event: string; label: string }
interface Payload {
  secure_storage_configured: boolean;
  delivery: { configured_destinations: number; selected_destinations: number; runtime_ready: boolean; emergency_stop: boolean; reason: string; delivery_ready: boolean; last_configured_at: string | null };
  destinations: Destination[]; channel_definitions: Definition[]; event_definitions: EventDefinition[];
}

const channelIcons = { email: Mail, slack: Hash, whatsapp: MessageCircle };
const defaultEvents = ["queue_age", "interactive_backlog", "dependency_cooldown", "worker_unready", "dead_letter", "indeterminate_action", "database_unavailable"];
const errorCopy: Record<string, string> = {
  notification_email_invalid: "Enter a valid alert email address.",
  notification_whatsapp_invalid: "Use an international WhatsApp number such as +962790000000.",
  notification_slack_webhook_invalid: "Use a Slack incoming-webhook URL from hooks.slack.com.",
  notification_label_invalid: "Use a label between 3 and 80 characters.",
  notification_events_invalid: "Select at least one alert event.",
  credential_encryption_not_configured: "Secure credential storage is not configured on this environment.",
};

export function NotificationSettings() {
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [payload, setPayload] = useState<Payload | null>(null);
  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await authenticatedFetch("/api/admin/notifications", { cache: "no-store" });
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("load_failed");
      setPayload(await response.json() as Payload); setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <div className="page-stack notification-settings-page">
    <PageHeading title="Notification settings" description="Choose where Tanaghom should send operational alerts after the protected delivery runtime is approved." />
    <SettingsNavigation />
    {state === "loading" ? <NotificationLoading /> : null}
    {state === "forbidden" ? <SettingsState title="Admin access required" copy="Only an active Tanaghom Admin can manage customer notification destinations." /> : null}
    {state === "error" ? <SettingsState title="Notification settings unavailable" copy="Tanaghom could not load the protected destination records." action={<button className="secondary-button" onClick={() => void load()}><RefreshCw size={16} />Try again</button>} /> : null}
    {state === "ready" && payload ? <>
      <section className="notification-safety" aria-labelledby="notification-safety-title">
        <ShieldCheck size={20} />
        <div><strong id="notification-safety-title">Destination setup does not activate delivery</strong><p>{payload.delivery.reason}. No provider call or message is sent when you save these settings.</p></div>
        <StatusPill tone={payload.delivery.delivery_ready ? "success" : "attention"}>{payload.delivery.delivery_ready ? "Delivery ready" : "Delivery locked"}</StatusPill>
      </section>
      <section className="notification-readiness" aria-labelledby="notification-readiness-title">
        <header><div><h2 id="notification-readiness-title">Delivery readiness</h2><p>Customer destinations and platform activation are intentionally separate controls.</p></div><span>{payload.delivery.selected_destinations} configured</span></header>
        <ul>
          <ReadinessItem ready={payload.secure_storage_configured}>Encrypted destination storage</ReadinessItem>
          <ReadinessItem ready={payload.delivery.selected_destinations > 0}>At least one customer destination</ReadinessItem>
          <ReadinessItem ready={payload.delivery.runtime_ready}>Reviewed notification runtime</ReadinessItem>
          <ReadinessItem ready={!payload.delivery.emergency_stop}>Platform emergency control cleared</ReadinessItem>
        </ul>
      </section>
      <section className="destination-section" aria-labelledby="destinations-title">
        <header className="section-heading compact-heading"><div><h2 id="destinations-title">Alert destinations</h2><p>Values are encrypted on save and only the final characters remain visible.</p></div></header>
        <div className="destination-list">
          {payload.channel_definitions.map((definition) => <DestinationPanel key={definition.channel} definition={definition}
            destination={payload.destinations.find((item) => item.channel === definition.channel)} events={payload.event_definitions}
            storageReady={payload.secure_storage_configured} onChanged={load} />)}
        </div>
      </section>
    </> : null}
  </div>;
}

function DestinationPanel({ definition, destination, events, storageReady, onChanged }: { definition: Definition; destination?: Destination; events: EventDefinition[]; storageReady: boolean; onChanged: () => Promise<void> }) {
  const Icon = channelIcons[definition.channel];
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(destination?.label || `${definition.label} operations`);
  const [target, setTarget] = useState("");
  const [severity, setSeverity] = useState<Severity>(destination?.minimum_severity || "warning");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(destination?.event_types || defaultEvents);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = useMemo(() => new Set(selectedEvents), [selectedEvents]);

  async function save() {
    setBusy(true); setFeedback("");
    try {
      const response = await authenticatedFetch("/api/admin/notifications", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: definition.channel, label, target, minimum_severity: severity, event_types: selectedEvents }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "save_failed");
      setTarget(""); setEditing(false); setFeedback("Destination saved securely. Delivery remains locked."); await onChanged();
    } catch (error) { const code = error instanceof Error ? error.message : "save_failed"; setFeedback(errorCopy[code] || "Tanaghom could not save this destination."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!destination) return;
    setBusy(true); setFeedback("");
    try {
      const response = await authenticatedFetch(`/api/admin/notifications/${destination.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete_failed");
      setConfirmDelete(false); setEditing(false); await onChanged();
    } catch { setFeedback("Tanaghom could not remove this destination."); }
    finally { setBusy(false); }
  }
  function toggle(event: string) { setSelectedEvents((current) => current.includes(event) ? current.filter((item) => item !== event) : [...current, event]); }

  return <article className="destination-panel">
    <header><span className="destination-icon"><Icon size={19} /></span><div><h3>{definition.label}</h3><p>{definition.credential_source}</p></div><StatusPill tone={destination ? "success" : "neutral"}>{destination ? "Configured" : "Not configured"}</StatusPill></header>
    {destination && !editing ? <div className="destination-summary"><dl><div><dt>Destination</dt><dd>{destination.target_mask}</dd></div><div><dt>Minimum severity</dt><dd>{destination.minimum_severity}</dd></div><div><dt>Events</dt><dd>{destination.event_types.length} selected</dd></div></dl><div className="destination-actions"><button className="secondary-button" type="button" onClick={() => setEditing(true)}>Rotate or edit</button><button className="text-danger-button" type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={15} />Remove</button></div></div> : null}
    {!destination || editing ? <div className="destination-form">
      <label><span>Destination label</span><input value={label} onChange={(event) => setLabel(event.target.value)} minLength={3} maxLength={80} disabled={busy} /></label>
      <label><span>{definition.target_label}</span><input type={definition.channel === "email" ? "email" : "password"} value={target} onChange={(event) => setTarget(event.target.value)} placeholder={definition.target_example} autoComplete="off" disabled={busy} /><small>This value will not be shown again after saving.</small></label>
      <label><span>Minimum severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value as Severity)} disabled={busy}><option value="info">Info</option><option value="warning">Warning</option><option value="error">Error</option><option value="critical">Critical</option></select></label>
      <fieldset><legend>Events to monitor</legend><div className="event-checklist">{events.map((item) => <label key={item.event}><input type="checkbox" checked={selected.has(item.event)} onChange={() => toggle(item.event)} disabled={busy} /><span>{item.label}</span></label>)}</div></fieldset>
      <div className="destination-form-actions">{destination ? <button className="secondary-button" type="button" disabled={busy} onClick={() => { setEditing(false); setTarget(""); setFeedback(""); }}>Cancel</button> : null}<button className="primary-button" type="button" disabled={busy || !storageReady || !target.trim() || label.trim().length < 3 || selectedEvents.length === 0} onClick={() => void save()}>{busy ? "Saving..." : destination ? "Rotate and save" : "Save destination"}</button></div>
    </div> : null}
    {confirmDelete ? <div className="destination-delete-confirm" role="alert"><CircleAlert size={17} /><p><strong>Remove {definition.label}?</strong><span>Future delivery cannot use this destination. Existing audit records stay intact.</span></p><button className="secondary-button" type="button" onClick={() => setConfirmDelete(false)}>Keep</button><button className="text-danger-button" type="button" disabled={busy} onClick={() => void remove()}>Remove</button></div> : null}
    {feedback ? <p className="integration-feedback" role="status" aria-live="polite">{feedback}</p> : null}
  </article>;
}

function ReadinessItem({ ready, children }: { ready: boolean; children: React.ReactNode }) { return <li className={ready ? "readiness-yes" : "readiness-no"}><span aria-hidden="true" />{children}</li>; }
function NotificationLoading() { return <div className="notification-loading" aria-label="Loading notification settings"><span className="state-skeleton" /><span className="state-skeleton" /><span className="state-skeleton" /></div>; }
function SettingsState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) { return <section className="settings-state"><BellRing size={24} /><div><h2>{title}</h2><p>{copy}</p></div>{action}</section>; }
