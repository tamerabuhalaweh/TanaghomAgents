"use client";

import {
  Activity,
  BrainCircuit,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Gauge,
  ListOrdered,
  LoaderCircle,
  RefreshCw,
  Server,
  ShieldAlert,
  Sparkles,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { LocaleToggle } from "@/components/creative/locale-toggle";
import type { CreativeLocale } from "@/lib/i18n/creative";
import { formatArabicCount, formatDate, formatMoney, formatNumber, normalizeNumericInput, numericLocale } from "@/lib/i18n/format";

interface WaitlistEntry {
  email: string | null;
  company_name: string | null;
  organization_id: string | null;
  locale: "en" | "ar";
  queue_position: number;
  joined_at: string;
}

interface RecentWorkspace {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_tier: "starter" | "growth" | "scale" | null;
  created_at: string;
  campaigns_count: number;
}

interface UnitEconomicsWorkspace {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_tier: "starter" | "growth" | "scale" | null;
  used_launch100: boolean;
  created_at: string;
  monthly_revenue_usd: number;
  campaigns_count: number;
  month_campaigns_used: number;
  month_prompt_tokens: number;
  month_completion_tokens: number;
  month_total_tokens: number;
  tokens_limit: number;
  estimated_ai_cost_usd: number;
  net_margin_usd: number;
  gross_margin_pct: number | null;
  margin_status: "healthy" | "watch" | "at_risk" | "sandbox";
}

interface Snapshot {
  kpis: {
    total_workspaces: number;
    workspaces_by_status: Record<string, number>;
    total_users: number;
    verified_users: number;
    subscribers_by_tier: Record<"starter" | "growth" | "scale", number>;
    estimated_mrr_usd: number;
  };
  launch100: { enabled: boolean; max_redemptions: number; used: number; remaining: number };
  cohort: {
    cap: number;
    unlimited: boolean;
    active_count: number;
    waitlist_count: number;
    waitlist_entries: WaitlistEntry[];
  };
  ai_usage: {
    campaigns_total: number;
    campaigns_en: number;
    campaigns_ar: number;
    tasks_succeeded: number;
    tasks_failed: number;
    month_total_tokens: number;
    estimated_ai_spend_usd: number;
    gross_margin_usd: number;
    gross_margin_pct: number | null;
    at_risk_workspaces_count: number;
  };
  unit_economics: UnitEconomicsWorkspace[];
  recent_workspaces: RecentWorkspace[];
  ai_circuit_breaker: { enabled: boolean; emergency_stop: boolean; reason: string; updated_at: string };
  services: {
    database: string;
    ai_worker_configured: boolean;
    postiz_configured: boolean;
    stripe_configured: boolean;
  };
}

const COPY = {
  en: {
    title: "Platform cockpit",
    eyebrow: "Tanaghom · owner console",
    lede: "Live commercial, cohort, and operational control for the platform — no SSH required.",
    refresh: "Refresh",
    loading: "Loading live telemetry…",
    unauthorized: "This area is restricted to the platform owner.",
    loadFailed: "Telemetry could not be loaded.",
    actionFailed: "The action could not be completed.",
    saved: "Control updated.",
    revenue: "Revenue & growth",
    health: "System health",
    launch: "Launch & cohort",
    ledger: "Workspaces & waitlist",
    workspaces: "Workspaces",
    verifiedUsers: "Verified users",
    totalUsers: "of {total} users",
    paidSubscribers: "Active paid subscribers",
    tierSplit: "Starter {starter} · Growth {growth} · Scale {scale}",
    mrr: "Live MRR",
    estimated: "Estimated from active subscriptions",
    launchRemaining: "LAUNCH100 places remaining",
    launch100Used: "{used} of {max} redeemed",
    campaigns: "Campaigns generated",
    campaignSplit: "EN {en} · AR {ar}",
    aiSpend: "Monthly AI token spend",
    tokens: "{tokens} tokens",
    tasks: "{ok} succeeded · {failed} failed",
    database: "PostgreSQL",
    aiWorker: "AI model worker",
    publishing: "Social publishing",
    billing: "Stripe billing",
    connected: "Connected",
    configured: "Configured",
    notConfigured: "Not configured",
    operational: "Operational",
    paused: "Paused",
    maintenance: "Maintenance",
    breakerTitle: "AI generation circuit breaker",
    breakerReason: "Reason",
    breakerReset: "Reset AI circuit breaker",
    breakerBody: "Instantly restore generation after an incident. The reset is recorded in the platform audit ledger.",
    presets: "Instant presets",
    inviteCohort: "Invite-only cohort: 20",
    launchCohort: "Launch 100 cohort: 100",
    openAccess: "Open public access: Unlimited",
    customCap: "Custom active-workspace cap",
    applyCap: "Apply cap",
    capPlaceholder: "20",
    promo: "LAUNCH100 promo",
    promoBody: "Auto-applies $15 / $25 / $50 at checkout while launch places remain.",
    promoOn: "Promo on",
    promoOff: "Promo off",
    currentState: "Active workspaces {active} · cap {cap} · waitlist {waitlist}",
    unlimited: "Unlimited",
    recent: "Recent workspaces",
    name: "Workspace",
    status: "Status",
    plan: "Plan",
    campaignsShort: "Campaigns",
    created: "Created",
    queue: "Priority waitlist",
    queuePosition: "#",
    company: "Company",
    email: "Email",
    joined: "Joined",
    noWaitlist: "No companies are waiting.",
    noWorkspaces: "No workspaces yet.",
    tierNone: "—",
    autoRefresh: "Refreshes every 30 seconds",
    unitEconomics: "Customer Unit Economics & Cost Center",
    unitEconomicsLede: "Revenue, campaign usage, token ceilings, and AI cost per account for the latest 50 workspaces.",
    grossMargin: "Gross margin",
    atRiskSummary: "{count} at-risk workspaces",
    workspaceAndStatus: "Workspace & status",
    planRevenue: "Plan & monthly revenue (USD)",
    campaignsRun: "Campaigns (month / total)",
    monthlyTokens: "Monthly AI tokens (used / limit)",
    estimatedAiCost: "Estimated AI cost (USD)",
    netMargin: "Net margin (USD & %)",
    marginHealth: "Margin health",
    monthTotal: "{month} / {total}",
    usedLimit: "{used} / {limit}",
    monthly: "monthly",
    marginHealthy: "Healthy",
    marginWatch: "Watch",
    marginAtRisk: "At-Risk",
    marginSandbox: "Sandbox",
    noEconomics: "No customer economics yet.",
  },
  ar: {
    title: "لوحة المنصة",
    eyebrow: "تناغم · وحدة تحكم المالك",
    lede: "تحكم تجاري وتشغيلي مباشر في المنصة والدفعات — دون الحاجة إلى الوصول التقني المباشر.",
    refresh: "تحديث",
    loading: "جارٍ تحميل البيانات المباشرة…",
    unauthorized: "هذه المنطقة مخصصة لمالك المنصة فقط.",
    loadFailed: "تعذر تحميل البيانات.",
    actionFailed: "تعذر تنفيذ الإجراء.",
    saved: "تم تحديث التحكم.",
    revenue: "الإيرادات والنمو",
    health: "صحة النظام",
    launch: "الإطلاق والدفعات",
    ledger: "مساحات العمل وقائمة الانتظار",
    workspaces: "مساحات العمل",
    verifiedUsers: "المستخدمون الموثّقون",
    totalUsers: "من أصل {total} مستخدمين",
    paidSubscribers: "المشتركون المدفوعون النشطون",
    tierSplit: "باقة البداية {starter} · باقة النمو {growth} · باقة التوسع {scale}",
    mrr: "الإيراد الشهري المباشر",
    estimated: "تقديري من الاشتراكات النشطة",
    launchRemaining: "أماكن عرض الإطلاق المتبقية",
    launch100Used: "استُخدم {used} من أصل {max}",
    campaigns: "الحملات المولّدة",
    campaignSplit: "إنجليزي {en} · عربي {ar}",
    aiSpend: "إنفاق وحدات الذكاء الاصطناعي الشهري",
    tokens: "{tokens} وحدة ذكاء اصطناعي",
    tasks: "نجحت {ok} · فشلت {failed}",
    database: "PostgreSQL",
    aiWorker: "محرك الذكاء الاصطناعي",
    publishing: "النشر الاجتماعي",
    billing: "فوترة Stripe",
    connected: "متصل",
    configured: "مهيأ",
    notConfigured: "غير مهيأ",
    operational: "يعمل بشكل طبيعي",
    paused: "متوقف",
    maintenance: "صيانة",
    breakerTitle: "الإيقاف الطارئ للتوليد",
    breakerReason: "السبب",
    breakerReset: "إعادة تفعيل محرك الذكاء الاصطناعي",
    breakerBody: "استعد التوليد فوراً بعد أي حادث. تُسجّل إعادة الضبط في سجل تدقيق المنصة.",
    presets: "إعدادات سريعة",
    inviteCohort: "دفعة بالدعوة فقط: 20",
    launchCohort: "دفعة الإطلاق 100: 100",
    openAccess: "وصول عام مفتوح: بلا حد",
    customCap: "حد مخصص لمساحات العمل النشطة",
    applyCap: "تطبيق الحد",
    capPlaceholder: "20",
    promo: "عرض LAUNCH100",
    promoBody: "يُطبق تلقائياً بسعر 15 / 25 / 50 دولاراً عند الدفع طالما بقيت مقاعد الإطلاق.",
    promoOn: "العرض مفعّل",
    promoOff: "العرض متوقف",
    currentState: "النشط {active} · الحد {cap} · قائمة الانتظار {waitlist}",
    unlimited: "بلا حد",
    recent: "أحدث مساحات العمل",
    name: "مساحة العمل",
    status: "الحالة",
    plan: "الخطة",
    campaignsShort: "الحملات",
    created: "أُنشئت",
    queue: "قائمة الأولوية",
    queuePosition: "الترتيب",
    company: "الشركة",
    email: "البريد",
    joined: "الانضمام",
    noWaitlist: "لا توجد شركات في قائمة الانتظار.",
    noWorkspaces: "لا توجد مساحات عمل بعد.",
    tierNone: "—",
    autoRefresh: "يُحدَّث كل 30 ثانية",
    unitEconomics: "مركز تكلفة العملاء واقتصاديات الوحدة",
    unitEconomicsLede: "الإيراد واستهلاك الحملات وحدود وحدات الذكاء الاصطناعي وتكلفتها لكل حساب لأحدث 50 مساحة عمل.",
    grossMargin: "الهامش الإجمالي",
    atRiskSummary: "{count} مساحة عمل مرتفعة التكلفة",
    workspaceAndStatus: "مساحة العمل والحالة",
    planRevenue: "الخطة والإيراد الشهري (دولارًا)",
    campaignsRun: "الحملات (الشهر / الإجمالي)",
    monthlyTokens: "وحدات الذكاء الاصطناعي الشهرية (المستخدم / الحد)",
    estimatedAiCost: "التكلفة التقديرية للذكاء الاصطناعي (دولارًا)",
    netMargin: "الهامش الصافي (دولارًا و%)",
    marginHealth: "صحة الهامش",
    monthTotal: "{month} / {total}",
    usedLimit: "{used} / {limit}",
    monthly: "شهريًا",
    marginHealthy: "سليم",
    marginWatch: "مراقبة",
    marginAtRisk: "مرتفع التكلفة",
    marginSandbox: "تجريبي",
    noEconomics: "لا تتوفر اقتصاديات عملاء بعد.",
  },
} as const;

function format(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

function number(value: number, locale: CreativeLocale) {
  return formatNumber(value, locale);
}

function tierLabel(value: string | null, locale: CreativeLocale) {
  if (!value) return "—";
  if (locale !== "ar") return value[0].toUpperCase() + value.slice(1);
  return ({ starter: "البداية", growth: "النمو", scale: "التوسع" } as Record<string, string>)[value] || value;
}

function money(value: number, locale: CreativeLocale, decimals = 0) {
  if (locale === "ar") {
    return `${formatNumber(value, "ar", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })} دولارًا`;
  }
  return formatMoney(value, locale, "USD", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function compact(value: number, locale: CreativeLocale) {
  return new Intl.NumberFormat(numericLocale(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function breakerReason(reason: string, locale: CreativeLocale) {
  if (!reason) return "—";
  if (locale === "en") return reason;
  const labels: Record<string, string> = {
    operational: "يعمل بشكل طبيعي",
    emergency_stop: "إيقاف طارئ",
    manual_override: "إيقاف يدوي",
    circuit_open: "التوليد موقوف مؤقتًا",
    provider_outage: "انقطاع المزود",
    maintenance: "صيانة",
    paused: "متوقف",
  };
  return labels[reason.toLowerCase()] ?? "حالة تشغيلية مسجلة";
}

function subscriptionStatus(status: string, locale: CreativeLocale) {
  const labels: Record<string, [string, string]> = {
    trialing: ["Trialing", "تجريبي"],
    active: ["Active", "نشط"],
    past_due: ["Past due", "متأخرة السداد"],
    canceled: ["Canceled", "ملغاة"],
  };
  return labels[status]?.[locale === "ar" ? 1 : 0] || status;
}

function marginLabel(status: UnitEconomicsWorkspace["margin_status"], locale: CreativeLocale) {
  const labels = {
    healthy: ["Healthy", "سليم"],
    watch: ["Watch", "مراقبة"],
    at_risk: ["At-Risk", "مرتفع التكلفة"],
    sandbox: ["Sandbox", "تجريبي"],
  } as const;
  return labels[status][locale === "ar" ? 1 : 0];
}

function date(value: string, locale: CreativeLocale) {
  return formatDate(value, locale);
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`super-pill ${ok ? "super-pill-ok" : "super-pill-warn"}`}>{ok ? <CheckCircle2 size={12} /> : <ShieldAlert size={12} />}{children}</span>;
}

export function SuperAdminConsole({ initialLocale, dir }: { initialLocale: CreativeLocale; dir: "ltr" | "rtl" }) {
  const [locale, setLocale] = useState<CreativeLocale>(initialLocale);
  const text = COPY[locale];
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cap, setCap] = useState("20");
  const [unlimited, setUnlimited] = useState(false);
  const [promoEnabled, setPromoEnabled] = useState(true);

  useEffect(() => setLocale(initialLocale), [initialLocale]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/super-admin", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 404) {
        setError(text.unauthorized);
        return;
      }
      if (!response.ok) throw new Error(`super_admin_${response.status}`);
      const data = await response.json() as Snapshot;
      setSnapshot(data);
      setCap(String(data.cohort.cap));
      setUnlimited(data.cohort.unlimited);
      setPromoEnabled(data.launch100.enabled);
      setError("");
    } catch {
      setError(text.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [text.loadFailed, text.unauthorized]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function post(body: Record<string, unknown>, action: string, success: string) {
    if (busy) return;
    setBusy(action);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/super-admin", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 404) {
        setError(text.unauthorized);
        return;
      }
      if (!response.ok) throw new Error(`super_admin_${response.status}`);
      await load(true);
      setNotice(success);
    } catch {
      setError(text.actionFailed);
    } finally {
      setBusy(null);
    }
  }

  async function saveConfig(next: { cap: number; unlimited: boolean; enabled: boolean }) {
    await post({
      action: "update_launch_config",
      cohort_cap: next.cap,
      cohort_unlimited: next.unlimited,
      launch100_enabled: next.enabled,
    }, "update_launch_config", text.saved);
  }

  const paidSubscribers = snapshot
    ? snapshot.kpis.subscribers_by_tier.starter + snapshot.kpis.subscribers_by_tier.growth + snapshot.kpis.subscribers_by_tier.scale
    : 0;
  const aiPaused = Boolean(snapshot?.ai_circuit_breaker.emergency_stop);

  return (
    <main className="super-admin-page" dir={dir} lang={locale}>
      <header className="super-admin-header">
        <div className="super-admin-brand">
          <span className="super-admin-mark"><Gauge size={22} /></span>
          <div><span className="super-admin-eyebrow">{text.eyebrow}</span><h1>{text.title}</h1><p>{text.lede}</p></div>
        </div>
        <div className="super-admin-header-actions">
          <LocaleToggle locale={locale} />
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading || Boolean(busy)}>
            <RefreshCw size={15} className={loading ? "spin" : ""} />{text.refresh}
          </button>
        </div>
      </header>

      {error ? <div className="super-alert super-alert-error" role="alert"><ShieldAlert size={17} />{error}</div> : null}
      {notice ? <div className="super-alert super-alert-ok" role="status"><CheckCircle2 size={17} />{notice}</div> : null}

      {loading && !snapshot ? <div className="super-loading"><LoaderCircle className="spin" size={24} />{text.loading}</div> : null}

      {snapshot ? <>
        <section className="super-grid super-grid-kpis" aria-label={text.revenue}>
          <article className="super-kpi">
            <div className="super-kpi-label"><Building2 size={15} />{text.workspaces}</div>
            <strong>{number(snapshot.kpis.total_workspaces, locale)}</strong>
            <small>{Object.entries(snapshot.kpis.workspaces_by_status).map(([status, count]) => `${subscriptionStatus(status, locale)} ${number(count, locale)}`).join(" · ")}</small>
          </article>
          <article className="super-kpi">
            <div className="super-kpi-label"><Users size={15} />{text.verifiedUsers}</div>
            <strong>{number(snapshot.kpis.verified_users, locale)}</strong>
            <small>{format(text.totalUsers, { total: number(snapshot.kpis.total_users, locale) })}</small>
          </article>
          <article className="super-kpi">
            <div className="super-kpi-label"><CreditCard size={15} />{text.paidSubscribers}</div>
            <strong>{number(paidSubscribers, locale)}</strong>
            <small>{format(text.tierSplit, {
              starter: snapshot.kpis.subscribers_by_tier.starter,
              growth: snapshot.kpis.subscribers_by_tier.growth,
              scale: snapshot.kpis.subscribers_by_tier.scale,
            })}</small>
          </article>
          <article className="super-kpi super-kpi-accent">
            <div className="super-kpi-label"><CircleDollarSign size={15} />{text.mrr}</div>
            <strong dir="ltr">{money(snapshot.kpis.estimated_mrr_usd, locale)}</strong>
            <small>{text.estimated}</small>
          </article>
          <article className="super-kpi">
            <div className="super-kpi-label"><Sparkles size={15} />{text.launchRemaining}</div>
            <strong>{number(snapshot.launch100.remaining, locale)} <span>/ {number(snapshot.launch100.max_redemptions, locale)}</span></strong>
            <small>{format(text.launch100Used, { used: snapshot.launch100.used, max: snapshot.launch100.max_redemptions })}</small>
          </article>
          <article className="super-kpi">
            <div className="super-kpi-label"><Zap size={15} />{text.campaigns}</div>
            <strong>{number(snapshot.ai_usage.campaigns_total, locale)}</strong>
            <small>{format(text.campaignSplit, { en: snapshot.ai_usage.campaigns_en, ar: snapshot.ai_usage.campaigns_ar })}</small>
          </article>
          <article className="super-kpi">
            <div className="super-kpi-label"><Wallet size={15} />{text.aiSpend}</div>
            <strong dir="ltr">{money(snapshot.ai_usage.estimated_ai_spend_usd, locale, 2)}</strong>
            <small>{format(text.tokens, { tokens: compact(snapshot.ai_usage.month_total_tokens, locale) })}</small>
          </article>
        </section>

        <section className="super-grid super-grid-main">
          <article className="super-panel super-panel-health">
            <div className="super-panel-head">
              <div><span className="super-panel-icon"><Activity size={17} /></span><h2>{text.health}</h2></div>
              <span className="super-auto">{text.autoRefresh}</span>
            </div>
            <div className="super-health-list">
              <div><span><Server size={15} />{text.database}</span><Pill ok={snapshot.services.database === "connected"}>{snapshot.services.database === "connected" ? text.connected : snapshot.services.database}</Pill></div>
              <div><span><BrainCircuit size={15} />{text.aiWorker}</span><Pill ok={snapshot.services.ai_worker_configured && !aiPaused}>{!snapshot.services.ai_worker_configured ? text.notConfigured : aiPaused ? text.paused : text.operational}</Pill></div>
              <div><span><Sparkles size={15} />{text.publishing}</span><Pill ok={snapshot.services.postiz_configured}>{snapshot.services.postiz_configured ? text.configured : text.notConfigured}</Pill></div>
              <div><span><CreditCard size={15} />{text.billing}</span><Pill ok={snapshot.services.stripe_configured}>{snapshot.services.stripe_configured ? text.configured : text.notConfigured}</Pill></div>
            </div>
            <div className={`super-breaker ${aiPaused ? "super-breaker-paused" : ""}`}>
              <div className="super-breaker-head"><ShieldAlert size={17} /><strong>{text.breakerTitle}</strong></div>
              <p>{text.breakerBody}</p>
              <small><span>{text.breakerReason}: </span><span>{breakerReason(snapshot.ai_circuit_breaker.reason, locale)}</span> · {date(snapshot.ai_circuit_breaker.updated_at, locale)}</small>
              <button className={aiPaused ? "primary-button" : "secondary-button"} type="button" disabled={Boolean(busy)} onClick={() => void post({ action: "reset_ai_circuit_breaker" }, "reset", text.saved)}>
                {busy === "reset" ? <LoaderCircle className="spin" size={16} /> : <ShieldAlert size={16} />}{text.breakerReset}
              </button>
            </div>
          </article>

          <article className="super-panel super-panel-launch">
            <div className="super-panel-head"><div><span className="super-panel-icon"><Sparkles size={17} /></span><h2>{text.launch}</h2></div></div>
            <p className="super-launch-state">{format(text.currentState, {
              active: snapshot.cohort.active_count,
              cap: snapshot.cohort.unlimited ? text.unlimited : snapshot.cohort.cap,
              waitlist: snapshot.cohort.waitlist_count,
            })}</p>
            <div className="super-presets">
              <button type="button" className={!unlimited && snapshot.cohort.cap === 20 ? "super-preset super-preset-active" : "super-preset"} disabled={Boolean(busy)} onClick={() => void saveConfig({ cap: 20, unlimited: false, enabled: promoEnabled })}>{text.inviteCohort}</button>
              <button type="button" className={!unlimited && snapshot.cohort.cap === 100 ? "super-preset super-preset-active" : "super-preset"} disabled={Boolean(busy)} onClick={() => void saveConfig({ cap: 100, unlimited: false, enabled: promoEnabled })}>{text.launchCohort}</button>
              <button type="button" className={unlimited ? "super-preset super-preset-active" : "super-preset"} disabled={Boolean(busy)} onClick={() => void saveConfig({ cap: snapshot.cohort.cap, unlimited: true, enabled: promoEnabled })}>{text.openAccess}</button>
            </div>
            <div className="super-cap-row">
              <label><span>{text.customCap}</span><input type="number" min={1} max={100000} inputMode="numeric" value={cap} onChange={(event) => setCap(normalizeNumericInput(event.target.value))} /></label>
              <button className="secondary-button" type="button" disabled={Boolean(busy) || !Number.isSafeInteger(Number(cap)) || Number(cap) < 1 || Number(cap) > 100000} onClick={() => void saveConfig({ cap: Number(cap), unlimited: false, enabled: promoEnabled })}>{text.applyCap}</button>
            </div>
            <div className="super-promo">
              <div><strong><Sparkles size={15} />{text.promo}</strong><p>{text.promoBody}</p></div>
              <button type="button" role="switch" aria-checked={promoEnabled} className={`super-switch ${promoEnabled ? "super-switch-on" : ""}`} disabled={Boolean(busy)} onClick={() => { const next = !promoEnabled; setPromoEnabled(next); void saveConfig({ cap: unlimited ? snapshot.cohort.cap : Number(cap) || snapshot.cohort.cap, unlimited, enabled: next }); }}>
                <span />{promoEnabled ? text.promoOn : text.promoOff}
              </button>
            </div>
          </article>
        </section>

        <section className="super-panel super-ledger" aria-labelledby="unit-economics-title">
          <div className="super-panel-head">
            <div><span className="super-panel-icon"><Wallet size={17} /></span><div><h2 id="unit-economics-title">{text.unitEconomics}</h2><p className="super-econ-lede">{text.unitEconomicsLede}</p></div></div>
            <div className="super-econ-summary">
              <span>{text.grossMargin} <strong dir="ltr">{money(snapshot.ai_usage.gross_margin_usd, locale, 2)}</strong>{snapshot.ai_usage.gross_margin_pct === null ? "" : ` · ${number(snapshot.ai_usage.gross_margin_pct, locale)}%`}</span>
              <span className="super-econ-risk">{locale === "ar" ? formatArabicCount(snapshot.ai_usage.at_risk_workspaces_count, { zero: "لا مساحات عمل مرتفعة التكلفة", one: "مساحة عمل واحدة مرتفعة التكلفة", two: "مساحتا عمل مرتفعتا التكلفة", few: "{count} مساحات عمل مرتفعة التكلفة", many: "{count} مساحة عمل مرتفعة التكلفة", other: "{count} مساحة عمل مرتفعة التكلفة" }) : format(text.atRiskSummary, { count: number(snapshot.ai_usage.at_risk_workspaces_count, locale) })}</span>
            </div>
          </div>
          <div className="super-table-wrap">
            <table className="super-table super-econ-table">
              <thead><tr><th>{text.workspaceAndStatus}</th><th>{text.planRevenue}</th><th>{text.campaignsRun}</th><th>{text.monthlyTokens}</th><th>{text.estimatedAiCost}</th><th>{text.netMargin}</th><th>{text.marginHealth}</th></tr></thead>
              <tbody>
                {snapshot.unit_economics.map((workspace) => <tr key={workspace.id}>
                  <td><strong>{workspace.name}</strong><small>{workspace.slug} · <span className={`super-status super-status-${workspace.status}`}>{subscriptionStatus(workspace.status, locale)}</span></small></td>
                  <td><strong>{workspace.plan_tier ? tierLabel(workspace.plan_tier, locale) : text.tierNone}</strong><small dir="ltr">{money(workspace.monthly_revenue_usd, locale, 2)} {text.monthly}</small></td>
                  <td dir="ltr">{format(text.monthTotal, { month: number(workspace.month_campaigns_used, locale), total: number(workspace.campaigns_count, locale) })}</td>
                  <td dir="ltr">{format(text.usedLimit, { used: number(workspace.month_total_tokens, locale), limit: number(workspace.tokens_limit, locale) })}</td>
                  <td dir="ltr">{money(workspace.estimated_ai_cost_usd, locale, 2)}</td>
                  <td><strong dir="ltr">{money(workspace.net_margin_usd, locale, 2)}</strong><small dir="ltr">{workspace.gross_margin_pct === null ? text.tierNone : `${number(workspace.gross_margin_pct, locale)}%`}</small></td>
                  <td><span className={`super-margin super-margin-${workspace.margin_status}`}>{marginLabel(workspace.margin_status, locale)}</span></td>
                </tr>)}
                {!snapshot.unit_economics.length ? <tr><td colSpan={7} className="super-empty">{text.noEconomics}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="super-panel super-ledger">
          <div className="super-panel-head"><div><span className="super-panel-icon"><Building2 size={17} /></span><h2>{text.recent}</h2></div></div>
          <div className="super-table-wrap">
            <table className="super-table">
              <thead><tr><th>{text.name}</th><th>{text.status}</th><th>{text.plan}</th><th>{text.campaignsShort}</th><th>{text.created}</th></tr></thead>
              <tbody>
                {snapshot.recent_workspaces.map((workspace) => <tr key={workspace.id}>
                  <td><strong>{workspace.name}</strong><small>{workspace.slug}</small></td>
                  <td><span className={`super-status super-status-${workspace.status}`}>{subscriptionStatus(workspace.status, locale)}</span></td>
                  <td>{tierLabel(workspace.plan_tier, locale)}</td>
                  <td>{number(workspace.campaigns_count, locale)}</td>
                  <td>{date(workspace.created_at, locale)}</td>
                </tr>)}
                {!snapshot.recent_workspaces.length ? <tr><td colSpan={5} className="super-empty">{text.noWorkspaces}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="super-panel super-ledger">
          <div className="super-panel-head"><div><span className="super-panel-icon"><ListOrdered size={17} /></span><h2>{text.queue}</h2></div><span className="super-count">{snapshot.cohort.waitlist_count}</span></div>
          <div className="super-table-wrap">
            <table className="super-table">
              <thead><tr><th>{text.queuePosition}</th><th>{text.company}</th><th>{text.email}</th><th>{text.joined}</th></tr></thead>
              <tbody>
                {snapshot.cohort.waitlist_entries.map((entry) => <tr key={`${entry.queue_position}-${entry.email || entry.organization_id}`}>
                  <td><strong>#{number(entry.queue_position, locale)}</strong></td>
                  <td>{entry.company_name || text.tierNone}</td>
                  <td dir="ltr">{entry.email || text.tierNone}</td>
                  <td>{date(entry.joined_at, locale)}</td>
                </tr>)}
                {!snapshot.cohort.waitlist_entries.length ? <tr><td colSpan={4} className="super-empty">{text.noWaitlist}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </> : null}
    </main>
  );
}
