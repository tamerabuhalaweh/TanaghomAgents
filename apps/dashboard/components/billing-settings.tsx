"use client";

import { Check, CreditCard, ExternalLink, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";
import { WaitlistForm } from "./waitlist-form";

type PlanId = "starter" | "growth" | "scale";
type Status = "trialing" | "active" | "past_due" | "canceled";

interface BillingPlan {
  id: PlanId;
  amount_minor: number;
  promo_amount_minor: number;
  currency: string;
  interval: "month";
  monthly_campaigns: number;
  configured: boolean;
}

interface LaunchOffer {
  launch100_active: boolean;
  redemptions_used: number;
  redemptions_remaining: number;
  cohort_cap: number;
  active_workspaces: number;
  cohort_full: boolean;
  queue_position: number | null;
}

interface BillingPayload {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  subscription_status: Status;
  plan_tier: PlanId | null;
  stripe_price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  has_stripe_customer: boolean;
  stripe_customer_id_masked: string | null;
  billing_configured: boolean;
  can_manage_billing: boolean;
  currency: string;
  automatic_tax: boolean;
  plans: BillingPlan[];
  launch_offer: LaunchOffer;
}

const copy = {
  en: {
    title: "Billing & subscription",
    lede: "Review your workspace plan, start a secure Stripe Checkout, or manage invoices and payment methods in the Billing Portal.",
    status: "Workspace status",
    plan: "Current plan",
    periodEnd: "Current period ends",
    customer: "Stripe customer",
    tax: "Automatic tax",
    taxOn: "Calculated by Stripe at checkout",
    taxOff: "Not enabled on this environment",
    subscribe: "Subscribe",
    switchPlan: "Switch plan",
    current: "Current plan",
    manage: "Manage billing & invoices",
    opening: "Opening…",
    checkout: "Opening secure checkout…",
    ownerOnly: "Only the workspace Owner can change billing.",
    ownerOnlyBody: "You can review the subscription here. Ask the workspace Owner to start checkout or open the Billing Portal.",
    unconfigured: "Online checkout is not enabled on this environment.",
    unconfiguredBody: "Plans are shown for reference. The platform owner must add Stripe credentials and price IDs before checkout can start.",
    success: "Checkout completed. Stripe is confirming the subscription; the status below updates when the signed webhook arrives.",
    cancelled: "Checkout was cancelled. Nothing was charged.",
    loadError: "Tanaghom could not load billing details.",
    retry: "Retry",
    loading: "Loading billing details…",
    noPlan: "No paid plan yet",
    none: "Not available",
    cancels: "Cancels at the end of the current period",
    renews: "Renews automatically",
    notConfigured: "Not configured",
    planBlurb: {
      starter: "For a single brand finding its publishing rhythm.",
      growth: "For teams running multiple campaigns and channels.",
      scale: "For agencies operating a high-volume content engine.",
    },
    statusLabel: {
      trialing: "Trialing",
      active: "Active",
      past_due: "Past due",
      canceled: "Canceled",
    },
    perMonth: "per month",
    secure: "Payments are handled by Stripe. Tanaghom never receives card details.",
    checkoutError: "Stripe Checkout could not start. Try again shortly.",
    portalError: "The Billing Portal could not open. Try again shortly.",
    forbidden: "Only the workspace Owner can manage billing.",
    launchBadge: "LAUNCH100 — First 100 Workspaces",
    launchRemaining: "launch-price places remaining",
    listPrice: "List price",
    sandboxTitle: "Free 1-Campaign Sandbox active",
    sandboxBody: "Your workspace includes one complete AI Campaign Work Pack and three AI runs. Live social channels unlock on any paid plan.",
    reverseCharge: "B2B SaaS billed in USD by our UK Ltd entity. Outside the scope of UK VAT for international B2B customers under HMRC Notice 741A.",
    campaigns: "AI campaigns / month",
    cohortFull: "The current launch cohort is full. Join the priority waitlist below or contact the platform owner.",
    queue: "Your queue position",
    checkoutFull: "The launch cohort filled before checkout started. Your priority place has been saved.",
  },
  ar: {
    title: "الفوترة والاشتراك",
    lede: "راجع خطة مساحة العمل، وابدأ الدفع الآمن عبر Stripe، أو أدِر الفواتير ووسائل الدفع من بوابة الفوترة.",
    status: "حالة مساحة العمل",
    plan: "الخطة الحالية",
    periodEnd: "تنتهي الفترة الحالية في",
    customer: "عميل Stripe",
    tax: "الضريبة التلقائية",
    taxOn: "تُحتسب عبر Stripe عند الدفع",
    taxOff: "غير مفعّلة على هذه البيئة",
    subscribe: "اشترك",
    switchPlan: "تغيير الخطة",
    current: "الخطة الحالية",
    manage: "إدارة الفوترة والفواتير",
    opening: "جارٍ الفتح…",
    checkout: "جارٍ فتح الدفع الآمن…",
    ownerOnly: "مالك مساحة العمل وحده يمكنه تغيير الفوترة.",
    ownerOnlyBody: "يمكنك مراجعة الاشتراك هنا. اطلب من مالك مساحة العمل بدء الدفع أو فتح بوابة الفوترة.",
    unconfigured: "الدفع الإلكتروني غير مفعّل على هذه البيئة.",
    unconfiguredBody: "تُعرض الخطط للاطلاع. يجب على مالك المنصة إضافة بيانات Stripe ومعرّفات الأسعار قبل بدء الدفع.",
    success: "اكتمل الدفع. يتحقق Stripe من الاشتراك؛ تتحدث الحالة أدناه عند وصول إشعار الويب الموقّع.",
    cancelled: "أُلغي الدفع. لم يُخصم أي مبلغ.",
    loadError: "تعذر على تناغم تحميل تفاصيل الفوترة.",
    retry: "إعادة المحاولة",
    loading: "جارٍ تحميل تفاصيل الفوترة…",
    noPlan: "لا توجد خطة مدفوعة بعد",
    none: "غير متاح",
    cancels: "يُلغى في نهاية الفترة الحالية",
    renews: "يتجدد تلقائيًا",
    notConfigured: "غير مهيأة",
    planBlurb: {
      starter: "لعلامة واحدة تبني إيقاع نشرها.",
      growth: "لفرق تدير حملات وقنوات متعددة.",
      scale: "لوكالات تشغّل محتوى بحجم مرتفع.",
    },
    statusLabel: {
      trialing: "تجريبية",
      active: "نشطة",
      past_due: "متأخرة السداد",
      canceled: "ملغاة",
    },
    perMonth: "شهريًا",
    secure: "تتم المدفوعات عبر Stripe. لا تستلم تناغم بيانات البطاقة أبدًا.",
    checkoutError: "تعذر بدء الدفع عبر Stripe. حاول بعد قليل.",
    portalError: "تعذر فتح بوابة الفوترة. حاول بعد قليل.",
    forbidden: "مالك مساحة العمل وحده يمكنه إدارة الفوترة.",
    launchBadge: "LAUNCH100 — عرض الإطلاق لأول ١٠٠ مساحة عمل",
    launchRemaining: "مقعداً بسعر الإطلاق متبقٍ",
    listPrice: "السعر الأساسي",
    sandboxTitle: "الصندوق المجاني نشط: حملة واحدة كاملة",
    sandboxBody: "تشمل مساحتك حزمة حملة ذكاء اصطناعي كاملة وثلاث عمليات تشغيل. تُفتح قنوات التواصل الحقيقية مع أي خطة مدفوعة.",
    reverseCharge: "B2B SaaS billed in USD by our UK Ltd entity. Outside the scope of UK VAT for international B2B customers under HMRC Notice 741A.",
    campaigns: "حملة ذكاء اصطناعي شهرياً",
    cohortFull: "اكتملت الدفعة الحالية. انضم إلى قائمة الأولوية أدناه أو تواصل مع مالك المنصة.",
    queue: "ترتيبك في القائمة",
    checkoutFull: "اكتملت الدفعة قبل بدء الدفع. تم حفظ ترتيبك في قائمة الأولوية.",
  },
} as const;

const STATUS_TONE: Record<Status, "success" | "working" | "attention" | "danger"> = {
  active: "success",
  trialing: "working",
  past_due: "attention",
  canceled: "danger",
};

function formatMoney(amountMinor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale === "ar" ? "ar" : "en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function formatDate(value: string | null, locale: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-JO" : "en-GB", {
    dateStyle: "medium",
  }).format(date);
}

function planName(plan: PlanId | null, arabic: boolean) {
  if (!plan) return null;
  const labels: Record<PlanId, [string, string]> = {
    starter: ["Starter", "البداية"],
    growth: ["Growth", "النمو"],
    scale: ["Scale", "التوسع"],
  };
  return labels[plan][arabic ? 1 : 0];
}

export function BillingSettings() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const text = copy[locale];
  const [payload, setPayload] = useState<BillingPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [checkoutResult, setCheckoutResult] = useState<"success" | "cancelled" | "">("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("checkout");
    if (result === "success" || result === "cancelled") setCheckoutResult(result);
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setNotice("");
    try {
      const response = await authenticatedFetch("/api/billing", { cache: "no-store" });
      if (!response.ok) throw new Error("load_failed");
      setPayload(await response.json() as BillingPayload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function checkout(planId: PlanId) {
    if (busy || !payload) return;
    setBusy(planId);
    setNotice("");
    try {
      const response = await authenticatedFetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_tier: planId, company_name: payload.organization_name, locale }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; url?: string; queue_position?: number };
      if (response.status === 409 && body.error === "billing_not_configured") {
        setNotice(text.unconfigured);
        return;
      }
      if (response.status === 409 && body.error === "launch_cohort_full") {
        setNotice(`${text.checkoutFull}${body.queue_position ? ` ${text.queue} #${body.queue_position}.` : ""}`);
        await load();
        return;
      }
      if (!response.ok || !body.url) {
        setNotice(response.status === 403 ? text.forbidden : text.checkoutError);
        return;
      }
      window.location.assign(body.url);
    } catch {
      setNotice(text.checkoutError);
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    if (busy || !payload) return;
    setBusy("portal");
    setNotice("");
    try {
      const response = await authenticatedFetch("/api/billing/portal", { method: "POST" });
      const body = await response.json().catch(() => ({})) as { error?: string; url?: string };
      if (response.status === 409 && body.error === "billing_customer_not_found") {
        setNotice(text.noPlan);
        return;
      }
      if (!response.ok || !body.url) {
        setNotice(response.status === 403 ? text.forbidden : text.portalError);
        return;
      }
      window.location.assign(body.url);
    } catch {
      setNotice(text.portalError);
    } finally {
      setBusy(null);
    }
  }

  const periodEnd = formatDate(payload?.current_period_end || null, locale);
  const currentPlanName = planName(payload?.plan_tier || null, ar);

  return (
    <div className="page-stack billing-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <PageHeading title={text.title} description={text.lede} />

      {checkoutResult === "success" ? <div className="billing-banner billing-banner-success" role="status"><Check size={18} /> {text.success}</div> : null}
      {checkoutResult === "cancelled" ? <div className="billing-banner billing-banner-neutral" role="status">{text.cancelled}</div> : null}
      {notice ? <div className="billing-banner billing-banner-neutral" role="status">{notice}</div> : null}
      {state === "loading" ? <p className="channel-loading"><LoaderCircle className="spin" size={18} /> {text.loading}</p> : null}
      {state === "error" ? <div className="channel-empty"><CreditCard size={18} /><span><strong>{text.loadError}</strong></span><button className="secondary-button" type="button" onClick={() => void load()}><RefreshCw size={16} /> {text.retry}</button></div> : null}

      {state === "ready" && payload ? <>
        {!payload.can_manage_billing ? <div className="billing-banner billing-banner-neutral"><LockKeyhole size={17} /><span><strong>{text.ownerOnly}</strong> {text.ownerOnlyBody}</span></div> : null}
        {!payload.billing_configured ? <div className="billing-banner billing-banner-neutral"><ShieldCheck size={17} /><span><strong>{text.unconfigured}</strong> {text.unconfiguredBody}</span></div> : null}
        {payload.launch_offer?.launch100_active ? <div className="billing-banner billing-banner-success billing-launch-banner"><Sparkles size={18} /><span><strong>{text.launchBadge}</strong> — {payload.launch_offer.redemptions_remaining} {text.launchRemaining}. {text.reverseCharge}</span></div> : null}
        {payload.subscription_status !== "active" ? <div className="billing-sandbox-callout"><ShieldCheck size={19} /><div><strong>{text.sandboxTitle}</strong><p>{text.sandboxBody}</p></div></div> : null}
        {payload.launch_offer?.cohort_full ? <div className="billing-sandbox-callout billing-cohort-callout"><LockKeyhole size={19} /><div><strong>{text.cohortFull}</strong>{payload.launch_offer.queue_position ? <p>{text.queue}: <bdi>#{payload.launch_offer.queue_position}</bdi></p> : null}</div></div> : null}

        <section className="panel billing-summary" aria-labelledby="billing-summary-title">
          <header className="billing-summary-head">
            <div>
              <p className="eyebrow">{text.status}</p>
              <h2 id="billing-summary-title">{payload.organization_name}</h2>
              <p>{payload.organization_slug}</p>
            </div>
            <StatusPill tone={STATUS_TONE[payload.subscription_status]}>{text.statusLabel[payload.subscription_status]}</StatusPill>
          </header>
          <dl className="billing-meta">
            <div><dt>{text.plan}</dt><dd>{currentPlanName || text.noPlan}</dd></div>
            <div><dt>{text.periodEnd}</dt><dd>{periodEnd || text.none}</dd></div>
            <div><dt>{text.customer}</dt><dd>{payload.can_manage_billing ? payload.stripe_customer_id_masked || text.none : text.ownerOnly}</dd></div>
            <div><dt>{text.tax}</dt><dd>{payload.automatic_tax ? text.taxOn : text.taxOff}</dd></div>
          </dl>
          {payload.plan_tier ? <p className="billing-renewal">{payload.cancel_at_period_end ? text.cancels : text.renews}</p> : null}
          {payload.can_manage_billing && payload.has_stripe_customer ? <div className="billing-actions"><button className="primary-button" type="button" disabled={busy !== null || !payload.billing_configured} onClick={() => void openPortal()}><ExternalLink size={16} /> {busy === "portal" ? text.opening : text.manage}</button></div> : null}
        </section>

        <section className="billing-plans-section" aria-labelledby="billing-plans-title">
          <div className="billing-plans-head"><div><h2 id="billing-plans-title">{text.title}</h2><p>{text.secure}</p></div></div>
          <div className="billing-plans">
            {payload.plans.map((plan) => {
              const current = payload.plan_tier === plan.id;
              const disabled = !payload.can_manage_billing || !payload.billing_configured || !plan.configured || busy !== null || current;
              return <article className={`billing-plan ${current ? "billing-plan-current" : ""}`} key={plan.id}>
                <div className="billing-plan-head"><h3>{planName(plan.id, ar)}</h3>{current ? <StatusPill tone="success">{text.current}</StatusPill> : null}</div>
                <p className="billing-price">
                  {payload.launch_offer?.launch100_active ? <s>{formatMoney(plan.amount_minor, plan.currency, locale)}</s> : null}
                  <strong>{formatMoney(payload.launch_offer?.launch100_active ? plan.promo_amount_minor : plan.amount_minor, plan.currency, locale)}</strong><span>{text.perMonth}</span>
                </p>
                <small className="billing-plan-quota">{plan.monthly_campaigns} {text.campaigns}</small>
                <p className="billing-plan-copy">{text.planBlurb[plan.id]}</p>
                {!plan.configured ? <small className="billing-plan-missing">{text.notConfigured}</small> : <small className="billing-plan-missing" aria-hidden="true" />}
                <button className={current ? "secondary-button" : "primary-button"} type="button" disabled={disabled} onClick={() => void checkout(plan.id)}>
                  {busy === plan.id ? <LoaderCircle className="spin" size={16} /> : <CreditCard size={16} />}
                  {busy === plan.id ? text.checkout : current ? text.current : payload.plan_tier ? text.switchPlan : text.subscribe}
                </button>
              </article>;
            })}
          </div>
          {payload.launch_offer?.cohort_full ? <WaitlistForm locale={locale} /> : null}
          <p className="billing-reverse-charge">{text.reverseCharge}</p>
        </section>
      </> : null}
    </div>
  );
}
