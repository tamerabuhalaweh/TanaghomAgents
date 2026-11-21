"use client";

import { Check, MailPlus, RefreshCw, ShieldCheck, TriangleAlert, UserRoundCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
import { formatNumber } from "@/lib/i18n/format";
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

const TEAM_COPY = {
  en: {
    pageTitle: "Team & access",
    pageDescription: "Invite teammates and assign the least access each person needs.",
    inviteTeammate: "Invite teammate",
    invitationsDisabledTitle: "Email invitations are not configured yet.",
    setupAlertTitle: "Invitation emails need configuration",
    setupAlertCopy: "Existing team access can be managed now. Ask the platform owner to configure email delivery to enable invitation emails.",
    setupRequired: "Setup required",
    unavailableTitle: "Team access is unavailable",
    unavailableCopy: "No membership changes can be made until the workspace connection is restored.",
    retry: "Try again",
    forbiddenTitle: "Owner access required",
    forbiddenCopy: "Only the workspace owner can invite teammates or change roles.",
    peopleTitle: "People",
    activeLabel: "active",
    pendingLabel: "pending",
    youSuffix: " (you)",
    invitedPrefix: "Invited",
    invitedBy: "by",
    accountActivated: "Account activated",
    statusPending: "Pending",
    statusActive: "Active",
    statusInactive: "Inactive",
    roleLabel: "Role",
    deactivate: "Deactivate",
    activate: "Activate",
    roleGuideTitle: "Role guide",
    roleGuideCopy: "One role vocabulary everywhere: the owner role is labelled Owner here and in the sidebar.",
    accessUpdatedSuffix: "’s access was updated.",
    lastOwnerProtected: "E3lani protected the required admin access. Add another active admin before making this change.",
    accessSaveError: "The access change was not saved. Please try again.",
    inviteSkippedEmail: "Invitation created, but email delivery is not configured yet. Ask the platform owner to finish email setup before relying on invitations.",
    inviteSent: "Invitation sent. Access remains pending until the teammate accepts it.",
    inviteEmailFailed: "Invitation created, but the email could not be sent. Check the email delivery configuration.",
    invitePanelTitle: "Invite a teammate",
    invitePanelCopy: "E3lani sends a one-time acceptance link. The selected role applies when they set their password.",
    displayName: "Display name",
    workEmail: "Work email",
    cancel: "Cancel",
    sending: "Sending…",
    sendInvitation: "Send invitation",
    alreadyExists: "That email already has an account or invitation.",
    inviteSendError: "The invitation could not be sent. Check the address and try again.",
    roles: {
      owner: { label: "Owner", help: "Manage people, roles, and all operations." },
      reviewer: { label: "Reviewer", help: "Approve or reject public-facing content." },
      operator: { label: "Operator", help: "Operate campaigns and investigate agent work." },
      viewer: { label: "Viewer", help: "Read dashboards and reports only." },
    },
  },
  ar: {
    pageTitle: "الفريق والوصول",
    pageDescription: "ادعُ أعضاء فريقك وامنح كل شخص أقل صلاحية يحتاجها.",
    inviteTeammate: "دعوة عضو",
    invitationsDisabledTitle: "خدمة رسائل الدعوة غير مهيّأة بعد.",
    setupAlertTitle: "تحتاج رسائل الدعوة إلى تهيئة البريد",
    setupAlertCopy: "يمكنك إدارة صلاحيات الفريق الحالية الآن. اطلب من مالك المنصة تهيئة خدمة البريد لتفعيل إرسال الدعوات.",
    setupRequired: "يلزم الإعداد",
    unavailableTitle: "إدارة الفريق غير متاحة حاليًا",
    unavailableCopy: "لا يمكن تعديل العضويات حتى تستعيد المنصة اتصالها.",
    retry: "حاول مرة أخرى",
    forbiddenTitle: "يلزم صلاحية المالك",
    forbiddenCopy: "يمكن لمالك مساحة العمل فقط دعوة أعضاء جدد أو تغيير الأدوار.",
    peopleTitle: "الأعضاء",
    activeLabel: "نشط",
    pendingLabel: "بانتظار القبول",
    youSuffix: " (أنت)",
    invitedPrefix: "تمت الدعوة",
    invitedBy: "بواسطة",
    accountActivated: "الحساب مفعّل",
    statusPending: "معلّق",
    statusActive: "نشط",
    statusInactive: "معطّل",
    roleLabel: "الدور",
    deactivate: "تعطيل",
    activate: "تفعيل",
    roleGuideTitle: "دليل الأدوار",
    roleGuideCopy: "تسمية موحدة في كل مكان: يظهر دور المالك باسم «المالك» هنا وفي القائمة الجانبية.",
    accessUpdatedSuffix: " — تم تحديث صلاحيات الوصول.",
    lastOwnerProtected: "حافظ إعلاني على صلاحية المالك المطلوبة. أضف مالكًا نشطًا آخر قبل تنفيذ هذا التغيير.",
    accessSaveError: "لم يتم حفظ تعديل الصلاحية. حاول مرة أخرى.",
    inviteSkippedEmail: "تم إنشاء الدعوة، لكن إرسال البريد غير مهيّأ بعد. اطلب من مالك المنصة إكمال إعداد البريد.",
    inviteSent: "تم إرسال الدعوة. تبقى الحالة معلّقة حتى يقبلها العضو.",
    inviteEmailFailed: "تم إنشاء الدعوة، لكن تعذر إرسال البريد الإلكتروني. تحقق من إعدادات البريد.",
    invitePanelTitle: "دعوة عضو جديد",
    invitePanelCopy: "يرسل إعلاني رابط قبول لمرة واحدة، ويُطبَّق الدور المختار فور تعيين كلمة المرور.",
    displayName: "الاسم المعروض",
    workEmail: "بريد العمل الإلكتروني",
    cancel: "إلغاء",
    sending: "جارٍ الإرسال…",
    sendInvitation: "إرسال الدعوة",
    alreadyExists: "هذا البريد لديه حساب أو دعوة مسجّلة بالفعل.",
    inviteSendError: "تعذر إرسال الدعوة. تحقق من البريد الإلكتروني وحاول مرة أخرى.",
    roles: {
      owner: { label: "المالك", help: "إدارة الأعضاء والأدوار وجميع العمليات." },
      reviewer: { label: "مراجع", help: "اعتماد أو طلب تعديل المحتوى الموجه للجمهور." },
      operator: { label: "مشغّل", help: "تشغيل الحملات ومتابعة عمل الوكلاء." },
      viewer: { label: "مشاهد", help: "عرض لوحات التحكم والتقارير فقط." },
    },
  },
} as const;

type TeamStrings = (typeof TEAM_COPY)["en"] | (typeof TEAM_COPY)["ar"];

export function TeamManagement() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const text: TeamStrings = TEAM_COPY[locale];
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [invitationsConfigured, setInvitationsConfigured] = useState(false);
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
      const payload = await response.json() as { users: TeamUser[]; current_user_id: string; invitations_configured: boolean };
      setUsers(payload.users); setCurrentUserId(payload.current_user_id); setInvitationsConfigured(payload.invitations_configured); setState("ready");
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
      setFeedback(`${user.display_name}${text.accessUpdatedSuffix}`);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setFeedback(code === "last_owner_protected" || code === "cannot_change_own_owner_access"
        ? text.lastOwnerProtected
        : text.accessSaveError);
    } finally { setBusyId(""); }
  }

  const activeCount = formatNumber(users.filter((user) => user.is_active).length, locale);
  const pendingCount = formatNumber(users.filter((user) => user.invited_at && !user.accepted_at).length, locale);

  return (
    <div className="page-stack" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <PageHeading
        title={text.pageTitle}
        description={text.pageDescription}
        actions={state === "ready" ? (
          <button
            className="primary-button"
            type="button"
            disabled={!invitationsConfigured}
            title={!invitationsConfigured ? text.invitationsDisabledTitle : undefined}
            onClick={() => setInviteOpen((value) => !value)}
          >
            <MailPlus size={17} /> {text.inviteTeammate}
          </button>
        ) : undefined}
      />
      <p className="sr-only" role="status" aria-live="polite">{feedback}</p>
      {state === "loading" ? <TeamLoading /> : null}
      {state === "error" ? (
        <TeamState
          icon={<TriangleAlert />}
          title={text.unavailableTitle}
          copy={text.unavailableCopy}
          action={<button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={16} /> {text.retry}</button>}
        />
      ) : null}
      {state === "forbidden" ? <TeamState icon={<ShieldCheck />} title={text.forbiddenTitle} copy={text.forbiddenCopy} /> : null}
      {state === "ready" && inviteOpen ? (
        <InvitePanel
          text={text}
          onCreated={async (emailDelivery) => {
            setInviteOpen(false);
            setFeedback(emailDelivery === "skipped_unconfigured"
              ? text.inviteSkippedEmail
              : emailDelivery === "sent" || emailDelivery === "queued"
                ? text.inviteSent
                : text.inviteEmailFailed);
            await load();
          }}
          onCancel={() => setInviteOpen(false)}
        />
      ) : null}
      {state === "ready" && !invitationsConfigured ? (
        <section className="system-alert">
          <TriangleAlert size={20} />
          <div><strong>{text.setupAlertTitle}</strong><p>{text.setupAlertCopy}</p></div>
          <span className="system-alert-label">{text.setupRequired}</span>
        </section>
      ) : null}
      {state === "ready" ? (
        <section className="team-section" aria-labelledby="team-members-title">
          <div className="section-heading">
            <div>
              <h2 id="team-members-title">{text.peopleTitle}</h2>
              <p>{activeCount} {text.activeLabel} · {pendingCount} {text.pendingLabel}</p>
            </div>
          </div>
          <div className="team-list">
            {users.map((user) => {
              const ownAccount = user.id === currentUserId;
              const pending = Boolean(user.invited_at && !user.accepted_at);
              return (
                <article className="team-row" key={user.id}>
                  <span className="avatar">{user.display_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
                  <div className="team-identity">
                    <strong>{user.display_name}{ownAccount ? text.youSuffix : ""}</strong>
                    <span>{user.email}</span>
                    <small>{pending ? `${text.invitedPrefix}${user.invited_by_name ? ` ${text.invitedBy} ${user.invited_by_name}` : ""}` : text.accountActivated}</small>
                  </div>
                  <StatusPill tone={pending ? "attention" : user.is_active ? "success" : "neutral"}>
                    {pending ? text.statusPending : user.is_active ? text.statusActive : text.statusInactive}
                  </StatusPill>
                  <label className="team-control">
                    <span>{text.roleLabel}</span>
                    <select value={user.role} disabled={ownAccount || busyId === user.id} onChange={(event) => void update(user, event.target.value as Role, user.is_active)}>
                      {(Object.keys(text.roles) as Role[]).map((value) => (
                        <option key={value} value={value}>{text.roles[value].label}</option>
                      ))}
                    </select>
                  </label>
                  <button className="secondary-button compact-button" type="button" disabled={ownAccount || busyId === user.id} onClick={() => void update(user, user.role, !user.is_active)}>
                    {user.is_active ? text.deactivate : text.activate}
                  </button>
                </article>
              );
            })}
          </div>
          {feedback ? <p className="inline-feedback"><Check size={15} /> {feedback}</p> : null}
        </section>
      ) : null}
      {state === "ready" ? (
        <section className="role-guide" aria-labelledby="role-guide-title">
          <div className="section-heading"><div><h2 id="role-guide-title">{text.roleGuideTitle}</h2><p>{text.roleGuideCopy}</p></div></div>
          <div>
            {(Object.keys(text.roles) as Role[]).map((role) => (
              <article key={role}><strong>{text.roles[role].label}</strong><p>{text.roles[role].help}</p></article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function InvitePanel({
  text,
  onCreated,
  onCancel,
}: {
  text: TeamStrings;
  onCreated: (emailDelivery: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSubmitting(true); setError("");
    try {
      const response = await authenticatedFetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, display_name: name, role }) });
      const payload = await response.json() as { error?: string; email_delivery?: string };
      if (!response.ok) throw new Error(payload.error);
      await onCreated(payload.email_delivery ?? "unknown");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(code === "email_already_added" || code === "auth_user_already_exists" ? text.alreadyExists : text.inviteSendError);
      setSubmitting(false);
    }
  }
  return (
    <section className="invite-admin-panel" aria-labelledby="invite-admin-title">
      <div><h2 id="invite-admin-title">{text.invitePanelTitle}</h2><p>{text.invitePanelCopy}</p></div>
      <form onSubmit={submit}>
        <div className="form-field"><label htmlFor="invite-name">{text.displayName}</label><input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} required /></div>
        <div className="form-field"><label htmlFor="invite-email">{text.workEmail}</label><input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></div>
        <div className="form-field">
          <label htmlFor="invite-role">{text.roleLabel}</label>
          <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {(Object.keys(text.roles) as Role[]).map((value) => <option key={value} value={value}>{text.roles[value].label}</option>)}
          </select>
          <span className="field-help">{text.roles[role].help}</span>
        </div>
        <p className="login-error" role="alert">{error}</p>
        <div className="decision-actions">
          <button className="ghost-button" type="button" onClick={onCancel} disabled={submitting}>{text.cancel}</button>
          <button className="primary-button" type="submit" disabled={submitting}><UserRoundCheck size={17} /> {submitting ? text.sending : text.sendInvitation}</button>
        </div>
      </form>
    </section>
  );
}

function TeamLoading() { return <section className="team-section team-loading" aria-busy="true"><span className="state-skeleton state-skeleton-title" /><span className="state-skeleton" /><span className="state-skeleton" /><span className="state-skeleton" /></section>; }
function TeamState({ icon, title, copy, action }: { icon: React.ReactNode; title: string; copy: string; action?: React.ReactNode }) { return <section className="operations-state">{icon}<div><h2>{title}</h2><p>{copy}</p></div>{action}</section>; }
