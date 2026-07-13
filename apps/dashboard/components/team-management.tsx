"use client";

import { Check, MailPlus, RefreshCw, ShieldCheck, TriangleAlert, UserRoundCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

type Role = "owner" | "reviewer" | "operator" | "viewer";
interface TeamUser {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  invited_at: string | null;
  accepted_at: string | null;
  created_at: string;
  invited_by_name: string | null;
}

const roleLabels: Record<Role, string> = { owner: "Admin", reviewer: "Reviewer", operator: "Operator", viewer: "Viewer" };
const roleHelp: Record<Role, string> = {
  owner: "Manage people, roles, and all operations.", reviewer: "Approve or reject public-facing content.",
  operator: "Operate campaigns and investigate agent work.", viewer: "Read dashboards and reports only.",
};

export function TeamManagement() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await authenticatedFetch("/api/admin/users", { cache: "no-store" });
      if (response.status === 403) return setState("forbidden");
      if (!response.ok) throw new Error();
      const payload = await response.json() as { users: TeamUser[]; current_user_id: string };
      setUsers(payload.users); setCurrentUserId(payload.current_user_id); setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function update(user: TeamUser, role: Role, isActive: boolean) {
    setBusyId(user.id); setFeedback("");
    try {
      const response = await authenticatedFetch(`/api/admin/users/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, is_active: isActive }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error);
      setUsers((current) => current.map((member) => member.id === user.id ? { ...member, role, is_active: isActive } : member));
      setFeedback(`${user.display_name}'s access was updated.`);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setFeedback(code === "last_owner_protected" || code === "cannot_change_own_owner_access"
        ? "Tanaghom protected the required admin access. Add another active admin before making this change."
        : "The access change was not saved. Please try again.");
    } finally { setBusyId(""); }
  }

  return (
    <div className="page-stack">
      <PageHeading title="Team & access" description="Invite teammates and assign the least access each person needs." actions={state === "ready" ? <button className="primary-button" type="button" onClick={() => setInviteOpen((value) => !value)}><MailPlus size={17} /> Invite teammate</button> : undefined} />
      <p className="sr-only" role="status" aria-live="polite">{feedback}</p>
      {state === "loading" ? <TeamLoading /> : null}
      {state === "error" ? <TeamState icon={<TriangleAlert />} title="Team access is unavailable" copy="No membership changes can be made until the database connection is restored." action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={16} /> Try again</button>} /> : null}
      {state === "forbidden" ? <TeamState icon={<ShieldCheck />} title="Admin access required" copy="Only a Tanaghom Admin can invite teammates or change roles." /> : null}
      {state === "ready" && inviteOpen ? <InvitePanel onCreated={async () => { setInviteOpen(false); setFeedback("Invitation sent. Access remains pending until the teammate accepts it."); await load(); }} onCancel={() => setInviteOpen(false)} /> : null}
      {state === "ready" ? (
        <section className="team-section" aria-labelledby="team-members-title">
          <div className="section-heading"><div><h2 id="team-members-title">People</h2><p>{users.filter((user) => user.is_active).length} active · {users.filter((user) => user.invited_at && !user.accepted_at).length} pending</p></div></div>
          <div className="team-list">
            {users.map((user) => {
              const ownAccount = user.id === currentUserId;
              const pending = Boolean(user.invited_at && !user.accepted_at);
              return (
                <article className="team-row" key={user.id}>
                  <span className="avatar">{user.display_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                  <div className="team-identity"><strong>{user.display_name}{ownAccount ? " (you)" : ""}</strong><span>{user.email}</span><small>{pending ? `Invited${user.invited_by_name ? ` by ${user.invited_by_name}` : ""}` : "Account activated"}</small></div>
                  <StatusPill tone={pending ? "attention" : user.is_active ? "success" : "neutral"}>{pending ? "Pending" : user.is_active ? "Active" : "Inactive"}</StatusPill>
                  <label className="team-control"><span>Role</span><select value={user.role} disabled={ownAccount || busyId === user.id} onChange={(event) => void update(user, event.target.value as Role, user.is_active)}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <button className="secondary-button compact-button" type="button" disabled={ownAccount || busyId === user.id} onClick={() => void update(user, user.role, !user.is_active)}>{user.is_active ? "Deactivate" : "Activate"}</button>
                </article>
              );
            })}
          </div>
          {feedback ? <p className="inline-feedback"><Check size={15} /> {feedback}</p> : null}
        </section>
      ) : null}
      {state === "ready" ? <section className="role-guide" aria-labelledby="role-guide-title"><div className="section-heading"><div><h2 id="role-guide-title">Role guide</h2><p>Admin is the interface name for the existing owner role.</p></div></div><div>{(Object.keys(roleLabels) as Role[]).map((role) => <article key={role}><strong>{roleLabels[role]}</strong><p>{roleHelp[role]}</p></article>)}</div></section> : null}
    </div>
  );
}

function InvitePanel({ onCreated, onCancel }: { onCreated: () => Promise<void>; onCancel: () => void }) {
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSubmitting(true); setError("");
    try {
      const response = await authenticatedFetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, display_name: name, role }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error);
      await onCreated();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(code === "email_already_added" || code === "auth_user_already_exists" ? "That email already has an account or invitation." : "The invitation could not be sent. Check the address and try again.");
      setSubmitting(false);
    }
  }
  return <section className="invite-admin-panel" aria-labelledby="invite-admin-title"><div><h2 id="invite-admin-title">Invite a teammate</h2><p>Supabase sends a one-time setup email. Tanaghom applies the selected role after sign-in.</p></div><form onSubmit={submit}><div className="form-field"><label htmlFor="invite-name">Display name</label><input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} required /></div><div className="form-field"><label htmlFor="invite-email">Work email</label><input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></div><div className="form-field"><label htmlFor="invite-role">Role</label><select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Role)}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="field-help">{roleHelp[role]}</span></div><p className="login-error" role="alert">{error}</p><div className="decision-actions"><button className="ghost-button" type="button" onClick={onCancel} disabled={submitting}>Cancel</button><button className="primary-button" type="submit" disabled={submitting}><UserRoundCheck size={17} /> {submitting ? "Sending…" : "Send invitation"}</button></div></form></section>;
}

function TeamLoading() { return <section className="team-section team-loading" aria-busy="true"><span className="state-skeleton state-skeleton-title" /><span className="state-skeleton" /><span className="state-skeleton" /><span className="state-skeleton" /></section>; }
function TeamState({ icon, title, copy, action }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode }) { return <section className="operations-state">{icon}<div><h2>{title}</h2><p>{copy}</p></div>{action}</section>; }
