"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, Check, ChevronRight, ClipboardList, Download, FileText, Pause, Play, Plus, RefreshCw, UsersRound, X } from "lucide-react";
import Link from "next/link";

import { useLocale } from "@/lib/client/use-locale";
import { agentDeliverableLabel, agentDisplayName } from "@/lib/i18n/agent-names";
import { DIALECTS, dialectLabel, type DialectId } from "@/lib/i18n/dialects";
import { formatArabicCount, formatDateTime, formatNumber } from "@/lib/i18n/format";
import type { AppliedReviewCorrection, WorkspaceReviewCorrectionsSummary } from "@/lib/workspace-review-corrections";
import { WorkspacePostCards, type WorkspaceBrandKit } from "./workspace-post-cards";
import { WorkspaceImageQuota, postImageSlots, type WorkspaceImageQuotaStatus } from "./workspace-ai-images";

type Profile = { code: string; name: string; role: string; deliverable: string };
type Assignment = { id: string; title: string; language: "en" | "ar"; profile_codes: string[]; status: string; error_code: string | null; created_at: string; dialect?: DialectId | null };
type Artifact = { document: string; kind: string; provider: string | null; model: string | null; context_hash: string; source_tasks: string[]; procedure_version: string; elapsed_ms: number; usage: { total_tokens: number } | null };
type Step = { sequence: number; profile_code: string; task_id: string; status: string; attempt: number; claimed_at: string | null; finished_at: string | null; error_code: string | null; result: Artifact | null; response_hash: string | null; shared_context: { profile: string; task_id: string; document: string; response_hash: string }[] | null; applied_corrections?: AppliedReviewCorrection[] };
type Event = { id: number; event_type: string; actor_kind: string; actor_ref: string; evidence: { feedback?: string; sequence?: number; task_id?: string; error?: string; reason?: string }; occurred_at: string };
type Detail = Assignment & { brief: string; source_facts: string; result_hash: string; retries_used?: number; steps: Step[]; events: Event[]; review_corrections?: WorkspaceReviewCorrectionsSummary };
type Quota = { subscription_status: string; plan_tier: "starter" | "growth" | "scale" | null; is_sandbox: boolean; campaigns_used: number; campaigns_limit: number; runs_used: number; runs_limit: number | null; tokens_used: number; tokens_limit: number; max_retries_per_campaign: number; upgrade_required: boolean; upgrade_url: string };
type Usage = { month_prompt_tokens: number; month_completion_tokens: number; month_total_tokens: number; estimated_cost_usd: number };
type PostImage = { post_index: number; status: string; url: string | null; prompt_summary?: string | null };
type Data = { profiles: Profile[]; assignments: Assignment[]; selected: Detail | null; can_manage: boolean; can_review: boolean; quota: Quota; usage: Usage; brand_kit: WorkspaceBrandKit | null; default_dialect: DialectId; default_dialect_source: "brand_kit" | "location" | "default"; image_quota?: WorkspaceImageQuotaStatus | null; post_images?: PostImage[] | null; runtime: { ready: boolean; reason: string; provider: string; model: string; quality_certified: boolean } };

// One status vocabulary everywhere (Overview, /campaigns, /content, /workspace).
const labels: Record<string, string> = { draft: "Brief saved", queued: "Queued", running: "Working", paused: "Paused", waiting_review: "Ready for your review", approved: "Approved", rejected: "Changes requested", failed: "Needs attention", cancelled: "Cancelled", in_progress: "Working", succeeded: "Draft ready" };
const labelsAr: Record<string, string> = { draft: "تم حفظ الموجز", queued: "في الانتظار", running: "قيد العمل", paused: "متوقف مؤقتاً", waiting_review: "جاهز لمراجعتك", approved: "معتمدة", rejected: "طُلب التعديل", failed: "يحتاج إلى انتباه", cancelled: "أُلغي", in_progress: "قيد العمل", succeeded: "المسودة جاهزة" };
const errorText: Record<string, string> = { workspace_dialect_invalid: "Choose a valid Arabic content dialect.", workspace_model_not_configured: "The Gemini model worker is not connected. Your brief is saved; no generation has started.", workspace_not_found: "This assignment was not found in your workspace.", workspace_brief_invalid: "Write a brief between 30 and 6,000 characters.", workspace_source_facts_invalid: "Add source facts between 20 and 6,000 characters.", workspace_title_invalid: "Use a title between 3 and 120 characters.", inference_outcome_unknown: "The Gemini request timed out before a confirmed result. Completed work is preserved; click “Retry failed step” to continue.", output_rejected: "The result did not meet the document or context limits. Completed work is preserved; an operator must review the failure.", model_unavailable: "The configured Gemini connection or model identity could not be verified.", provider_request_rejected: "Google Gemini rejected the request. No automatic retry was made.", provider_quota_exceeded: "Gemini remained over quota after bounded retries. Completed work is preserved; retry when capacity is available.", workspace_cancelled: "This task was cancelled. Earlier completed work is preserved.", subscription_required_for_more_campaigns: "The Free Sandbox includes one complete campaign and three AI runs. Upgrade to continue.", plan_monthly_campaign_limit_reached: "This plan's monthly campaign limit has been reached. Upgrade or wait for the next month.", plan_monthly_token_limit_reached: "This plan's monthly AI token limit has been reached. Completed work is preserved; upgrade or wait until next month.", workspace_retry_limit_reached: "This campaign has reached its three-retry limit. Review the saved result or start a new campaign.", workspace_not_retryable: "Only a failed work pack can be retried.", workspace_runtime_stopped: "AI generation is paused by the platform. Your completed work is preserved; retry when generation resumes.", workspace_review_corrections_unapplied: "Brand Guardian flagged corrections that could not be applied automatically. Request changes so a revised pack applies them before approval." };
const errorTextAr: Record<string, string> = { workspace_dialect_invalid: "اختر لهجة محتوى عربية صحيحة.", workspace_model_not_configured: "محرك الذكاء الاصطناعي غير متصل. حُفظ موجزك ولم يبدأ أي توليد.", workspace_not_found: "لم يتم العثور على هذه المهمة في مساحة عملك.", workspace_brief_invalid: "اكتب موجزاً بين 30 و6,000 حرف.", workspace_source_facts_invalid: "أضف حقائق المصدر بين 20 و6,000 حرف.", workspace_title_invalid: "استخدم عنواناً بين 3 و120 حرفاً.", inference_outcome_unknown: "انتهت مهلة طلب Gemini قبل تأكيد النتيجة. عملك المكتمل محفوظ؛ اضغط «إعادة محاولة الخطوة المتوقفة» للمتابعة.", output_rejected: "لم تستوفِ النتيجة حدود المستند أو السياق. العمل المكتمل محفوظ ويحتاج إلى مراجعة المشغّل.", provider_quota_exceeded: "بقي Gemini فوق حد الحصة بعد محاولات محدودة. العمل المكتمل محفوظ؛ أعد المحاولة عند توفر السعة.", workspace_cancelled: "أُلغيت هذه المهمة، والعمل المكتمل محفوظ.", subscription_required_for_more_campaigns: "تشمل التجربة المجانية حملة متكاملة واحدة وثلاث عمليات توليد بالذكاء الاصطناعي. ارتقِ للمتابعة.", plan_monthly_campaign_limit_reached: "تم بلوغ الحد الشهري للحملات في هذه الخطة. ارتقِ أو انتظر الشهر التالي.", plan_monthly_token_limit_reached: "بلغت خطتك حد وحدات الذكاء الاصطناعي الشهري. عملك المكتمل محفوظ؛ ارتقِ بالخطة أو انتظر الشهر التالي.", workspace_retry_limit_reached: "بلغت هذه الحملة حد المحاولات الثلاث. راجع النتيجة المحفوظة أو ابدأ حملة جديدة.", workspace_not_retryable: "يمكن إعادة محاولة حزمة عمل متوقفة فقط.", workspace_runtime_stopped: "توليد المحتوى متوقف مؤقتًا من المنصة. عملك المكتمل محفوظ؛ يمكنك إعادة المحاولة بعد استئناف التوليد.", workspace_review_corrections_unapplied: "أدرج مدقّق الهوية تعديلات تعذّر تطبيقها تلقائيًا. اطلب تعديلات لإصدار نسخة منقّحة قبل الاعتماد." };
const date = (value: string, locale: "ar" | "en") => formatDateTime(value, locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
// The header badge must flip the moment a decision is accepted, not after the
// next poll returns.
const optimisticStatus: Record<string, string> = { approve: "approved", reject: "rejected", pause: "paused", resume: "queued", cancel: "cancelled", start: "queued", retry: "queued" };

export function AgencyWorkspace() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [data, setData] = useState<Data | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState(1);
  const [tab, setTab] = useState<"deliverable" | "context" | "history">("deliverable");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [profile, setProfile] = useState("team");
  const [language, setLanguage] = useState("en");
  const [dialect, setDialect] = useState<DialectId>("msa");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [facts, setFacts] = useState("");
  const key = useRef<string | null>(null);
  const requestGeneration = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const startAfterSave = useRef(false);
  // Polling and async callbacks read this ref so they never act on a stale id.
  const selectedIdRef = useRef<string | null>(null);
  // Set while a user command owns the in-flight fetch: polling must not abort it.
  const suspended = useRef(false);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const [feedbackHint, setFeedbackHint] = useState(false);
  // A decision that changes state is confirmed on a second, explicit click.
  const [confirmingReject, setConfirmingReject] = useState(false);

  const stateLabel = (status: string) => (ar ? labelsAr[status] : labels[status]) || status;
  // Once a pack is approved, its finished steps are approved too — not "Draft ready".
  const stepStateLabel = (item: Step) => (selected?.status === "approved" && item.status === "succeeded"
    ? (ar ? "معتمدة ضمن الحزمة" : "Approved in pack")
    : stateLabel(item.status));
  const reason = (code: string | null) => (ar ? errorTextAr[code || ""] : errorText[code || ""]) || (ar ? "يحتاج هذا العمل إلى مراجعة المشغّل. الأعمال المكتملة محفوظة." : "This assignment needs operator review. Completed artifacts are preserved.");

  const load = useCallback(async (id: string | null, quiet = false) => {
    const generation = ++requestGeneration.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    if (!quiet) setLoading(true);
    try {
      const r = await fetch(`/api/workspace${id ? `?id=${encodeURIComponent(id)}` : ""}`, { cache: "no-store", signal: controller.signal });
      if (r.status === 401) { window.location.assign("/login"); return; }
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "request_failed");
      if (generation === requestGeneration.current) { setData(result); setError(""); }
    } catch (e) {
      if (generation === requestGeneration.current && !(e instanceof Error && e.name === "AbortError")) {
        const code = (e as Error).message;
        setError((ar ? errorTextAr[code] : errorText[code]) || errorText[code] || (ar ? "تعذّر تحميل مساحة العمل. أعد التحديث للمحاولة مرة أخرى." : "We could not load this workspace. Refresh to try again."));
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [ar]);

  useEffect(() => { const id = new URLSearchParams(window.location.search).get("id"); setSelectedId(id); }, []);
  useEffect(() => { selectedIdRef.current = selectedId ?? data?.selected?.id ?? null; }, [selectedId, data?.selected?.id]);
  useEffect(() => { void load(selectedIdRef.current); const interval = setInterval(() => { if (!document.hidden && !suspended.current) void load(selectedIdRef.current, true); }, 5000); return () => { clearInterval(interval); abort.current?.abort(); }; }, [load, selectedId]);
  // Refresh on tab focus so a status changed elsewhere never looks stale.
  useEffect(() => { const refresh = () => { if (!document.hidden && !suspended.current) void load(selectedIdRef.current, true); }; window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh); return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); }; }, [load]);

  const selected = data?.selected;
  // While the pack is queued or running, follow the step state every 2 seconds.
  useEffect(() => {
    if (!selected || !["queued", "running"].includes(selected.status)) return;
    const timer = setInterval(() => { if (!document.hidden && !suspended.current) void load(selectedIdRef.current, true); }, 2000);
    return () => clearInterval(timer);
  }, [load, selected?.status, selected?.id]);
  const step = selected?.steps.find((s) => s.sequence === selectedStep) || selected?.steps[0];
  useEffect(() => { if (selected && !["queued", "running"].includes(selected.status)) setNotice((n) => (n.startsWith("Assignment queued.") ? "" : n)); }, [selected?.status, selected?.id]);

  const who = (code: string) => agentDisplayName(data?.profiles.find((p) => p.code === code)?.name || code, ar);

  function select(id: string) {
    selectedIdRef.current = id;
    setSelectedId(id); setSelectedStep(1); setCreating(false); setNotice(""); setFeedback(""); setConfirmingReject(false);
    window.history.replaceState(null, "", `/workspace?id=${id}`);
  }

  function applyStatus(id: string, status: string) {
    setData((current) => current ? {
      ...current,
      assignments: current.assignments.map((item) => (item.id === id ? { ...item, status } : item)),
      selected: current.selected?.id === id ? { ...current.selected, status } : current.selected,
    } : current);
  }

  async function command(body: Record<string, unknown>) {
    if (busy) return;
    const action = String(body.action);
    const targetId = typeof body.id === "string" ? body.id : selectedIdRef.current;
    setBusy(true); setError(""); setNotice("");
    suspended.current = true;
    try {
      const r = await fetch("/api/workspace", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 401) { window.location.assign("/login"); return; }
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "request_failed");
      if (action === "create") {
        key.current = null;
        const created = typeof result.id === "string" ? result.id : null;
        if (created) {
          // Switch the detail pane on the spot and insert the row optimistically
          // so the assignment count updates without waiting for a second fetch.
          const codes = profile === "team" ? data?.profiles.map((p) => p.code) ?? [] : [profile];
          const createdAt = new Date().toISOString();
          const createdLanguage = language === "ar" ? "ar" : "en";
          selectedIdRef.current = created;
          setSelectedId(created); setCreating(false); setSelectedStep(1); setFeedback(""); setFeedbackHint(false);
          window.history.replaceState(null, "", `/workspace?id=${created}`);
          setData((current) => current ? {
            ...current,
            assignments: [{ id: created, title, language: createdLanguage, profile_codes: codes, status: "draft", error_code: null, created_at: createdAt, dialect }, ...current.assignments.filter((item) => item.id !== created)],
            selected: { id: created, title, language: createdLanguage, profile_codes: codes, status: "draft", error_code: null, created_at: createdAt, dialect, brief, source_facts: facts, result_hash: "", retries_used: 0, steps: [], events: [] },
          } : current);
        }
        setTitle(""); setBrief(""); setFacts("");
        setNotice(ar ? "تم حفظ الموجز. راجع الحقائق المشتركة ثم ابدأ المهمة." : "Brief saved. Review the shared facts, then start the assignment.");
      } else {
        setNotice(body.action === "start"
          ? (ar ? "تم إرسال المهمة. سيستخدم المختصون موجزك المحفوظ ويسلّم كل منهم عمله للزميل التالي." : "Assignment queued. Specialists will use your saved brief and hand their work to the next teammate.")
          : body.action === "retry"
            ? (ar ? "أُعيد إرسال الخطوات غير المكتملة فقط. المخرجات المعتمدة والسجل محفوظان." : "Only the unfinished steps were re-queued. Completed deliverables and history are preserved.")
          : body.action === "approve"
            ? (ar ? "تم تسجيل اعتمادك لحزمة العمل هذه تحديداً. لم يُنشر أو يُرسل أي شيء." : "Your approval has been recorded for this exact work pack. Nothing was published or sent.")
            : body.action === "reject"
              ? (ar ? "تم حفظ ملاحظاتك. أنشئ مهمة منقّحة لإنتاج نسخة جديدة." : "Your feedback is saved. Create a revised assignment to produce a new version.")
              : (ar ? "تم تحديث حالة المهمة." : "Assignment state updated."));
      }
      const settled = typeof result.id === "string" ? result.id : targetId;
      const nextStatus = optimisticStatus[action];
      if (nextStatus && settled) applyStatus(settled, nextStatus);
      // This load belongs to the command; polling stays suspended until it lands.
      await load(settled, true);
      return typeof result.id === "string" ? result.id : null;
    } catch (e) {
      const code = (e as Error).message;
      setError((ar ? errorTextAr[code] : errorText[code]) || errorText[code] || (ar ? "لم تُقبل العملية. أعد التحميل للتحقق من الحالة؛ ولا يُفترض أي اعتماد." : "The action was not accepted. Refresh to check the latest state; no approval is assumed."));
    } finally { suspended.current = false; setBusy(false); }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    key.current ??= crypto.randomUUID();
    const startNow = startAfterSave.current;
    startAfterSave.current = false;
    void (async () => {
      const id = await command({ action: "create", title, brief, source_facts: facts, language, profile, dialect, idempotency_key: key.current });
      if (startNow && id) await command({ action: "start", id });
    })();
  }

  function newAssignment() {
    startAfterSave.current = false;
    setCreating(true); setError(""); setNotice(""); key.current = null;
    const nextLanguage = locale === "ar" ? "ar" : "en";
    setLanguage(nextLanguage);
    // English output defaults to White Arabic for any Arabic it carries.
    setDialect(nextLanguage === "en" ? "msa" : data?.default_dialect ?? "msa");
    setConfirmingReject(false);
    setTimeout(() => heading.current?.focus(), 0);
  }

  function insertFactsTemplate() {
    const template = ar
      ? "ما الذي نبيعه:\nالسعر المؤكد:\nالتواريخ والمواعيد المؤكدة:\nما يشمله العرض:\nالادعاءات المعتمدة فقط:\nنبرة العلامة:\nما هو غير معروف ويحتاج إلى مراجعة بشرية:"
      : "What we sell:\nConfirmed price:\nConfirmed dates and times:\nWhat the offer includes:\nApproved claims only:\nBrand tone:\nUnknown and needing human review:";
    setFacts((current) => (current.trim() ? `${current.trimEnd()}\n\n${template}` : template));
    key.current = null;
  }

  function fillExample(kind: "ar" | "en") {
    const example = kind === "ar"
      ? {
        title: "حملة دورة التسويق الرقمي — دفعة يناير",
        brief: "أطلق حملة عضوية لدورة التسويق الرقمي (8 جلسات، حضوري وأونلاين) لرواد الأعمال في الأردن. نريد مسودات عربية لإنستغرام ولينكدإن: منشور إعلان، كاروسيل من 4 شرائح، ونص لصفحة الهبوط. لا إعلانات مدفوعة ولا ادعاءات غير مثبتة.",
        facts: "السعر 180 ديناراً بدلاً من 240 عند التسجيل قبل 20 يناير. تشمل الدورة 8 جلسات أسبوعية وورشة عملية وشهادة حضور. تبدأ في 3 فبراير في عمّان بعدد مقاعد 18. المدرب ممارس معتمد في التسويق الرقمي. لا يوجد ضمان توظيف ولا يجوز ذكر أرقام مبيعات غير مؤكدة.",
      }
      : {
        title: "Digital marketing course — January cohort",
        brief: "Launch an organic campaign for our 8-session digital marketing course (in person and online) aimed at small-business owners in Jordan. Prepare English Instagram and LinkedIn drafts: one announcement post, a 4-slide carousel, and landing-page copy. No paid ads and no unverified claims.",
        facts: "The price is 180 JOD instead of 240 when registering before 20 January. The course includes 8 weekly sessions, a hands-on workshop and an attendance certificate. It starts on 3 February in Amman with 18 seats. The trainer is a certified digital marketing practitioner. There is no job guarantee, and unverified sales figures must not be used.",
      };
    setTitle(example.title); setBrief(example.brief); setFacts(example.facts); setLanguage(kind);
    setDialect(kind === "en" ? "msa" : data?.default_dialect ?? "msa");
    key.current = null; startAfterSave.current = false; setError("");
  }

  function download() {
    if (!selected) return;
    const english = `# ${selected.title}\n\nStatus: ${labels[selected.status] || selected.status}\n\n## Brief\n${selected.brief}\n\n## Owner-supplied source facts\n${selected.source_facts}\n\n`
      + selected.steps.filter((s) => s.result).map((s) => `## ${who(s.profile_code)}\nTask: ${s.task_id}\nVersion: ${s.response_hash}\n\n${s.result!.document}\n`).join("\n")
      + "\nDraft documents only. No external actions were performed.\n";
    const arabic = `# ${selected.title}\n\nالحالة: ${labelsAr[selected.status] || selected.status}\n\n## موجز المهمة\n${selected.brief}\n\n## الحقائق المعتمدة من المالك\n${selected.source_facts}\n\n`
      + selected.steps.filter((s) => s.result).map((s) => `## ${who(s.profile_code)}\nالمهمة: ${s.task_id}\nالإصدار: ${s.response_hash}\n\n${s.result!.document}\n`).join("\n")
      + "\nوثائق مسودة فقط. لم يتم تنفيذ أي إجراءات خارجية.\n";
    const contents = selected.language === "ar" ? arabic : english;
    const url = URL.createObjectURL(new Blob([contents], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `e3lani-workpack-${selected.id}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const tabsSpec = [["deliverable", ar ? "التسليم" : "Deliverable", FileText], ["context", ar ? "السياق المشترك" : "Shared context", BookOpen], ["history", ar ? "النشاط" : "Activity", ClipboardList]] as const;
  const quota = data?.quota;
  const planName = quota?.plan_tier
    ? (ar ? ({ starter: "البداية", growth: "النمو", scale: "التوسع" } as Record<string, string>)[quota.plan_tier] : `${quota.plan_tier[0].toUpperCase()}${quota.plan_tier.slice(1)}`)
    : "";
  const campaignForms = { zero: "لا حملات", one: "حملة واحدة", two: "حملتان", few: "{count} حملات", many: "{count} حملة", other: "{count} حملة" };
  const liveStep = selected
    ? (selected.steps.find((s) => s.status === "in_progress") ?? selected.steps.find((s) => s.status !== "succeeded"))
    : undefined;
  const liveRemaining = selected ? selected.steps.filter((s) => s.status !== "succeeded").length : 0;
  const liveSeconds = Math.max(5, liveRemaining * 5);
  const liveLabel = !selected ? "" : ar
    ? `جارٍ التنفيذ الآن — الخطوة ${liveStep?.sequence ?? 1} من ${selected.steps.length}: ${liveStep ? who(liveStep.profile_code) : "الفريق"} (تكتمل الحزمة خلال ~${liveSeconds} ثانية)…`
    : `In progress — Step ${liveStep?.sequence ?? 1} of ${selected.steps.length}: ${liveStep ? who(liveStep.profile_code) : "the team"} (~${liveSeconds}s remaining)…`;
  const quotaLabel = quota ? (quota.is_sandbox
    ? (ar ? `التجربة المجانية: ${formatArabicCount(quota.campaigns_used, campaignForms)} من ${formatArabicCount(quota.campaigns_limit, campaignForms)} · ${formatArabicCount(quota.runs_used, { zero: "لا عمليات توليد", one: "عملية توليد واحدة", two: "عمليتا توليد", few: "{count} عمليات توليد", many: "{count} عملية توليد", other: "{count} عملية توليد" })} بالذكاء الاصطناعي` : `Free Sandbox: ${quota.campaigns_used} of ${quota.campaigns_limit} campaign · ${quota.runs_used} of ${quota.runs_limit} AI runs used`)
    : (ar ? `باقة ${planName}: ${formatArabicCount(quota.campaigns_used, campaignForms)} من ${formatArabicCount(quota.campaigns_limit, campaignForms)} شهريًا` : `${planName} Plan: ${quota.campaigns_used} of ${quota.campaigns_limit} monthly campaigns used`)) : "";

  return <div className="agency-workspace">
    <header className="page-heading">
      <div>
        <h1>{ar ? "مساحة عمل الذكاء الاصطناعي" : "AI workspace"}</h1>
        <p>{ar ? "حدّد هدفًا واضحًا للمختصين، وتابع عملهم وسياقهم المشترك ومخرجاتهم." : "Give your specialists an outcome. Follow their work, shared context, and handoffs."}</p>
      </div>
      {data?.can_manage ? <button className="button button-primary" onClick={newAssignment}><Plus size={18} />{ar ? "موجز حملة جديد" : "New campaign brief"}</button> : null}
    </header>
    <div className="aw-boundary">
      <UsersRound size={18} />
      <span>{ar ? "مختصو الوكالة · مساحة مسودات فقط · مراجعة بشرية قبل الاستخدام" : "Agency specialists · Draft-only workspace · Human review before use"}</span>
      <span className={`aw-state ${data?.runtime.ready ? "aw-state-ready" : ""}`}>{data?.runtime.ready ? (ar ? "المختصون جاهزون" : "AI specialists ready") : (ar ? "وضع حفظ المسودات" : "Draft-save mode")}</span>
    </div>
    {quota ? <div className={`aw-quota ${quota.upgrade_required ? "aw-quota-limit" : ""}`}>
      <span className="aw-quota-badge">{quotaLabel}</span>
      <WorkspaceImageQuota quota={data?.image_quota} ar={ar} />
      <span className="aw-quota-usage">{ar ? `${formatNumber(quota.tokens_used, locale)} من ${formatNumber(quota.tokens_limit, locale)} وحدة ذكاء اصطناعي هذا الشهر — كل وحدة تمثل كمية صغيرة من النص المولَّد` : `${formatNumber(quota.tokens_used, locale)} of ${formatNumber(quota.tokens_limit, locale)} AI units this month — one unit is a small amount of generated text`}</span>
      {selected ? <span className="aw-quota-retries">{ar ? `إعادة المحاولة المستخدمة لهذه الحملة: ${formatNumber(selected.retries_used ?? 0, locale)} من ${formatNumber(quota.max_retries_per_campaign, locale)}` : `Retries used for this campaign: ${selected.retries_used ?? 0} of ${quota.max_retries_per_campaign}`}</span> : null}
      <span className="aw-quota-note">{ar ? "المحاولات الفاشلة أو التي انتهت مهلتها دون أي مخرج لا تستهلك رصيد الحملات الشهري." : "Failed or timed-out attempts with zero deliverables do not consume monthly campaign slots."}</span>
      {quota.is_sandbox ? <Link className="aw-quota-upgrade" href={quota.upgrade_url}>{ar ? "ترقية الخطة" : "Upgrade plan"} <ArrowRight size={15} /></Link> : null}
    </div> : null}
    {quota?.upgrade_required ? <section className="aw-upgrade-callout" role="status">
      <div><strong>{ar ? "بلغت حد التجربة المجانية" : "You have reached the Free Sandbox limit"}</strong><p>{ar ? "ارتقِ لبدء حملة أخرى وربط حسابات التواصل الحقيقية. سجل حملتك الحالي يبقى محفوظاً." : "Upgrade to start another campaign and connect live social accounts. Your existing campaign history stays intact."}</p></div>
      <Link className="button button-primary" href={quota.upgrade_url}>{ar ? "عرض الخطط" : "View plans"} <ArrowRight size={16} /></Link>
    </section> : null}
    {error ? <div className="aw-message aw-error" role="alert"><span>{error}</span><button className="button button-secondary" onClick={() => void load(selectedId)}><RefreshCw size={16} />{ar ? "تحديث" : "Refresh"}</button></div> : null}
    {notice ? <p className="aw-message" role="status">{notice}</p> : null}
    {loading && !data ? <div className="aw-loading" aria-busy="true" aria-label={ar ? "جارٍ تحميل مساحة العمل" : "Loading AI workspace"}><div /><div /><div /></div> : null}
    {data ? <>
      {!data.runtime.ready ? <p className="aw-runtime-note">{data.runtime.reason}</p> : null}
      <div className="aw-layout">
        <aside className="aw-assignments" aria-label={ar ? "المهام" : "Assignments"}>
          <h2>{ar ? "المهام" : "Assignments"} <span>{data.assignments.length}</span></h2>
          {data.assignments.length ? data.assignments.map((a) => <button key={a.id} onClick={() => select(a.id)} className={`aw-assignment ${selected?.id === a.id && !creating ? "aw-selected" : ""}`} aria-pressed={selected?.id === a.id && !creating}>
            <strong>{a.title}</strong><span>{stateLabel(a.status)}</span>
            <small>{a.language === "ar" ? (ar ? "العربية" : "Arabic") : (ar ? "الإنجليزية" : "English")} · {a.profile_codes.length === 1 ? (ar ? "مختص واحد" : "Specialist") : (ar ? "فريق" : "Team")} · {date(a.created_at, locale)}</small>
          </button>) : <p className="aw-muted">{ar ? "ستبقى موجزاتك وأعمالك المكتملة هنا." : "Your saved briefs and completed work will stay here."}</p>}
        </aside>
        <section className="aw-main">
          {creating ? <form className="aw-create" onSubmit={create}>
            <header><h2 ref={heading} tabIndex={-1}>{ar ? "أنشئ حملة أو مهمة جديدة" : "Create a Campaign / Task"}</h2><p>{ar ? "ما الذي تريد أن يجهّزه الفريق؟" : "What should the team create?"}</p></header>
            <div className="aw-actions">
              <button type="button" className="button button-secondary" onClick={() => fillExample("ar")}>{ar ? "تعبئة مثال عربي" : "Fill Arabic example"}</button>
              <button type="button" className="button button-secondary" onClick={() => fillExample("en")}>{ar ? "تعبئة مثال إنجليزي" : "Fill English example"}</button>
            </div>
            <div className="aw-form-row">
              <label>{ar ? "عنوان المهمة" : "Assignment title"}<input required minLength={3} maxLength={120} value={title} onChange={(e) => { setTitle(e.target.value); key.current = null; }} placeholder={ar ? "حزمة عمل حملة الدورة الصيفية" : "Summer course campaign work pack"} /></label>
              <label>{ar ? "لغة المخرجات" : "Output language"}<select value={language} onChange={(e) => { const next = e.target.value; setLanguage(next); setDialect(next === "en" ? "msa" : data?.default_dialect ?? "msa"); key.current = null; }}><option value="en">English</option><option value="ar">العربية — Arabic</option></select></label>
            </div>
            <div className="aw-dialect-field">
              <label>{language === "ar" ? (ar ? "لهجة المحتوى" : "Content dialect") : (ar ? "لهجة المحتوى العربي (عند طلب محتوى عربي أو ثنائي اللغة)" : "Arabic content dialect (used for Arabic or bilingual output)")}<select value={dialect} onChange={(e) => { setDialect(e.target.value as DialectId); key.current = null; }}>{DIALECTS.map((item) => <option key={item.id} value={item.id}>{dialectLabel(item.id, locale)}</option>)}</select></label>
              <small>{language === "en"
                ? (ar ? "الفصحى المعاصرة هي اللهجة الافتراضية للموجزات الإنجليزية وثنائية اللغة، ويمكنك اختيار لهجة محلية." : "Modern Standard Arabic (White Arabic) is the default for English and bilingual briefs; you can select a local dialect if preferred.")
                : data.default_dialect_source === "brand_kit"
                  ? (ar ? "محددة من لهجة هويتك البصرية، ويمكنك تغييرها لهذا الموجز." : "From your brand kit; you can change it for this brief.")
                  : data.default_dialect_source === "location"
                    ? (ar ? "محددة تلقائيًا حسب موقع نشاطك، ويمكنك تغييرها لهذا الموجز." : "Selected automatically from your business location; you can change it for this brief.")
                    : (ar ? "الفصحى المعاصرة هي اللهجة الافتراضية، ويمكنك اختيار لهجة أخرى." : "White Arabic is the default; choose another dialect if you prefer.")}</small>
            </div>
            <label>{ar ? "من يعمل على المهمة؟" : "Who should work on it?"}<select value={profile} onChange={(e) => { setProfile(e.target.value); key.current = null; }}><option value="team">{ar ? "حزمة عمل الحملة — المختصون الستة" : "Campaign Work Pack — all six specialists"}</option>{data.profiles.map((p) => <option key={p.code} value={p.code}>{agentDisplayName(p.name, ar)} — {agentDeliverableLabel(p.deliverable, ar)}</option>)}</select></label>
            <div className="aw-team-preview" aria-label={ar ? "المختصون المحددون" : "Selected specialists"}>{data.profiles.filter((p) => profile === "team" || p.code === profile).map((p, i) => <span key={p.code}>{i > 0 ? <ArrowRight size={14} /> : null}{agentDisplayName(p.name, ar)}</span>)}</div>
            <label>{ar ? "موجز المهمة" : "Task brief"}<textarea required minLength={30} maxLength={6000} rows={4} value={brief} onChange={(e) => { setBrief(e.target.value); key.current = null; }} placeholder={ar ? "صف الجمهور والهدف والقنوات المسموح بها والنبرة والمخرجات. مثال: مسودات إنستغرام عضوية لدورتنا دون إعلانات مدفوعة." : "Describe the audience, outcome, allowed channels, tone and deliverables. For example: prepare organic Instagram drafts for our course; no paid ads."} /></label>
            <label>{ar ? "حقائق المصدر المشتركة وإرشادات العلامة" : "Shared source facts & brand guidance"}<textarea required minLength={20} maxLength={6000} rows={6} value={facts} onChange={(e) => { setFacts(e.target.value); key.current = null; }} placeholder={ar ? "أضف الحقائق التي يجوز للفريق الاعتماد عليها: ما يشمله العرض، التواريخ أو الأسعار المؤكدة، الادعاءات المعتمدة، نبرة العلامة، وما هو غير معروف. لا تُدرج كلمات مرور أو بيانات عملاء حساسة." : "Add the facts the team may rely on: what the offer includes, confirmed dates or prices, approved claims, brand tone, and what is unknown. Do not include passwords or customer-sensitive data."} /></label>
            <div className="aw-facts-helper">
              <p className="aw-muted">{ar ? "مثال على الحقائق: «السعر 180 ديناراً عند التسجيل قبل 20 يناير، وتشمل الدورة 8 جلسات وورشة عملية، وتبدأ في 3 فبراير في عمّان، ولا يوجد ضمان توظيف». أضف فقط ما هو مؤكد." : "Fact example: “The price is 180 JOD before 20 January, the course includes 8 sessions and a hands-on workshop, it starts on 3 February in Amman, and there is no job guarantee.” Add only confirmed facts."}</p>
              <button type="button" className="button button-secondary" onClick={insertFactsTemplate}>{ar ? "إدراج قالب حقائق سريعة" : "Insert quick facts template"}</button>
            </div>
            <p className="aw-muted aw-visuals-note">{ar ? "ملاحظة حول المرئيات: ينشئ الفريق مسودات المنشورات وتوصيفات الصور وبطاقات تصميم جاهزة بهويتك البصرية (SVG/PNG). باقات النمو والتوسع تضيف صورة ذكاء اصطناعي واحدة لكل منشور ضمن الحصة الشهرية، وعند نفاد الحصة تُعرض البطاقة النصية كما هي." : "Visuals note: Your team produces post copy, photo briefs, and brand-styled social cards (SVG/PNG). Growth and Scale also generate one AI photo per post within the monthly image quota; when the quota is used up, posts keep the brand-styled text card."}</p>
            <p className="aw-muted">{ar ? "يُحفظ الموجز والحقائق كنسخة غير قابلة للتغيير. تُشارك مخرجات المختصين السابقة كمقترحات غير معتمدة، لا كحقائق جديدة. لا نشر ولا رسائل ولا مشتريات ولا تحديثات CRM." : "Source facts and the brief are saved as an immutable version. Earlier specialist outputs are shared as unapproved proposals—not new facts. No publishing, messaging, purchases or CRM updates."}</p>
            <div className="aw-actions">
              <button type="submit" className="button button-primary" disabled={busy} onClick={() => { startAfterSave.current = data.runtime.ready; }} title={data.runtime.ready ? undefined : data.runtime.reason}>{busy ? (ar ? "جارٍ الحفظ…" : "Saving…") : data.runtime.ready ? (ar ? "احفظ وابدأ الآن" : "Save & start now") : (ar ? "حفظ موجز المهمة" : "Save assignment brief")}<ChevronRight size={17} /></button>
              {data.runtime.ready ? <button type="submit" className="button button-secondary" disabled={busy} onClick={() => { startAfterSave.current = false; }}>{ar ? "حفظ المهمة" : "Save assignment"}</button> : null}
              <button type="button" className="button button-secondary" onClick={() => setCreating(false)} disabled={busy}>{ar ? "إلغاء" : "Cancel"}</button>
            </div>
            <p className="aw-muted aw-submit-note">{data.runtime.ready
              ? (ar ? "يُحفظ الموجز فوراً. يبدأ المختصون العمل بعد الحفظ، وتبقى كل النتائج مقترحات بانتظار اعتمادك." : "Your brief is saved immediately. Specialists start after saving, and every result stays a proposal until you approve it.")
              : (ar ? "يُحفظ موجزك فوراً ويمكنك العودة إليه في أي وقت. يتاح زر «احفظ وابدأ الآن» عندما يصبح محرك الذكاء الاصطناعي متصلاً." : "Your brief is saved immediately and stays available in your workspace. “Save & start now” activates when the live model worker is connected.")}</p>
          </form> : selected ? <>
            <header className="aw-assignment-header">
              <div><span className={`aw-state aw-state-${selected.status}`}>{stateLabel(selected.status)}</span><h2>{selected.title}</h2><p>{selected.language === "ar" ? (ar ? "العربية" : "Arabic") : (ar ? "الإنجليزية" : "English")}{selected.language === "ar" ? ` · ${dialectLabel(selected.dialect ?? "msa", locale)}` : ""} · {ar ? formatArabicCount(selected.profile_codes.length, { zero: "لا مختصين", one: "مختص واحد", two: "مختصان", few: "{count} مختصين", many: "{count} مختصًا", other: "{count} مختص" }) : `${selected.profile_codes.length} specialist${selected.profile_codes.length === 1 ? "" : "s"}`} · {ar ? "أُنشئت" : "Created"} {date(selected.created_at, locale)}</p></div>
              <div className="aw-actions">
                {selected.steps.some((s) => s.result) ? <button className="button button-secondary" onClick={download}><Download size={16} />{ar ? "تصدير الحزمة" : "Export pack"}</button> : null}
                {data.can_manage && selected.status === "draft" ? <button className="button button-primary" disabled={busy || !data.runtime.ready} onClick={() => void command({ action: "start", id: selected.id })}><Play size={16} />{busy ? (ar ? "جارٍ البدء…" : "Starting…") : (ar ? "بدء المهمة" : "Start assignment")}</button> : null}
                {data.can_manage && ["queued", "running"].includes(selected.status) ? <button className="button button-secondary" disabled={busy} onClick={() => void command({ action: "pause", id: selected.id })}><Pause size={16} />{ar ? "إيقاف مؤقت" : "Pause"}</button> : null}
                {data.can_manage && selected.status === "paused" ? <button className="button button-primary" disabled={busy || !data.runtime.ready} onClick={() => void command({ action: "resume", id: selected.id })}><Play size={16} />{ar ? "استئناف" : "Resume"}</button> : null}
                {data.can_manage && selected.status === "failed" ? <button className="button button-primary" disabled={busy || !data.runtime.ready} onClick={() => void command({ action: "retry", id: selected.id })}><RefreshCw size={16} />{busy ? (ar ? "جارٍ إعادة المحاولة…" : "Retrying…") : (ar ? "إعادة محاولة الخطوة المتوقفة" : "Retry failed step")}</button> : null}
              </div>
            </header>
            {selected.error_code ? <p className="aw-message aw-error" role="alert">{reason(selected.error_code)}</p> : null}
            {selected.status === "draft" ? <section className="aw-brief">
              <h3>{ar ? "سياق المهمة المشترك" : "Shared assignment context"}</h3>
              <p className="aw-prose" dir="auto">{selected.brief}</p>
              <details open><summary><BookOpen size={16} />{ar ? "حقائق المصدر وإرشادات العلامة" : "Source facts & brand guidance"}</summary><p className="aw-prose" dir="auto">{selected.source_facts}</p></details>
              <h3>{ar ? "مختصوك" : "Your specialists"}</h3>
              <ol className="aw-roster-preview">{selected.profile_codes.map((code) => <li key={code}><strong>{who(code)}</strong><span>{agentDeliverableLabel(data.profiles.find((p) => p.code === code)?.deliverable, ar)}</span></li>)}</ol>
            </section> : <>
              <div className="aw-progress" aria-label={ar ? "تقدم المهام" : "Task progress"}>{["queued", "running"].includes(selected.status) && selected.steps.length ? <strong className="aw-progress-live" role="status">{liveLabel}</strong> : null}<span>{ar ? `${formatArabicCount(selected.steps.filter((s) => s.status === "succeeded").length, { zero: "لا مخرجات جاهزة", one: "مخرج واحد جاهز", two: "مخرجان جاهزان", few: "{count} مخرجات جاهزة", many: "{count} مخرجًا جاهزًا", other: "{count} مخرج جاهز" })} من ${formatArabicCount(selected.steps.length, { zero: "لا مخرجات", one: "مخرج واحد", two: "مخرجان", few: "{count} مخرجات", many: "{count} مخرجًا", other: "{count} مخرج" })}` : `${selected.steps.filter((s) => s.status === "succeeded").length} of ${selected.steps.length} deliverables ready`}</span><progress max={selected.steps.length || 1} value={selected.steps.filter((s) => s.status === "succeeded").length} /><small>{ar ? "حالة مسجّلة · تُحدَّث كل 5 ثوانٍ" : "Recorded task state · refreshes every 5 seconds"}</small></div>
              <div className="aw-workbench">
                <nav className="aw-roster" aria-label={ar ? "مهام المختصين" : "Specialist tasks"}>{selected.steps.map((s) => <button key={s.task_id} onClick={() => { setSelectedStep(s.sequence); setTab("deliverable"); }} className={step?.task_id === s.task_id ? "aw-selected" : ""} aria-pressed={step?.task_id === s.task_id}><span className={`aw-step-number aw-step-${s.status}`}>{s.status === "succeeded" ? <Check size={16} /> : s.sequence}</span><span><strong>{who(s.profile_code)}</strong><small>{s.status === "queued" && s.sequence > 1 ? (ar ? "بانتظار تسليم الزميل السابق" : "Waiting for prior handoff") : stepStateLabel(s)}</small></span></button>)}</nav>
                <div className="aw-artifact-panel">
                  <div className="aw-tabs" role="tablist" aria-label={ar ? "تفاصيل المهمة" : "Assignment detail"} onKeyDown={(event) => { const ids = ["deliverable", "context", "history"] as const; const index = ids.indexOf(tab); const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null; if (next !== null) { event.preventDefault(); setTab(ids[next]); document.getElementById(`aw-tab-${ids[next]}`)?.focus(); } }}>{tabsSpec.map(([id, label, Icon]) => <button key={id} role="tab" id={`aw-tab-${id}`} tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls="aw-detail" onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</div>
                  <section id="aw-detail" role="tabpanel" tabIndex={0} aria-labelledby={`aw-tab-${tab}`}>
                    {tab === "deliverable" && step ? <>
                      <header className="aw-artifact-title"><h3>{agentDeliverableLabel(data.profiles.find((p) => p.code === step.profile_code)?.deliverable, ar)}</h3><p>{who(step.profile_code)} · {stepStateLabel(step)}</p></header>
                      {step.result ? <>
                        {step.applied_corrections?.length ? <aside className="aw-corrections-applied" aria-label={ar ? "تعديلات مدقّق الهوية المطبّقة" : "Applied Brand Guardian corrections"}>
                          <strong>{ar ? `تم تطبيق تعديلات مدقّق الهوية تلقائياً (${step.applied_corrections.length})` : `Brand Guardian corrections applied (${step.applied_corrections.length})`}</strong>
                          <details>
                            <summary>{ar ? "عرض التعديلات المطبّقة" : "View applied corrections"}</summary>
                            <ul>{step.applied_corrections.map((item, idx) => <li key={`${item.step_sequence}-${idx}`}>{item.action === "remove"
                              ? (ar ? `أُزيل: «${item.exact}»` : `Removed: “${item.exact}”`)
                              : (ar ? `«${item.exact}» ← «${item.replacement}»` : `“${item.exact}” → “${item.replacement}”`)}</li>)}</ul>
                          </details>
                        </aside> : null}
                        <article className="aw-document" dir={selected.language === "ar" ? "rtl" : "ltr"} lang={selected.language}>{step.result.document}</article>
                        {step.profile_code === "content_creator" ? <WorkspacePostCards document={step.result.document} kit={data.brand_kit} language={selected.language} images={postImageSlots(data.post_images)} /> : null}
                        <footer className="aw-artifact-meta">
                          <span>{step.result.kind === "deterministic_summary" ? (ar ? "ملخص تسليم حتمي" : "Deterministic delivery summary") : `${ar ? "توليد" : "Generated by"} ${step.result.provider} · ${step.result.model}`}</span>
                          <span>{step.result.kind === "deterministic_summary"
                            ? (ar
                              ? `0 وحدة · 0.0 ثانية لهذه الخطوة · إجمالي الحزمة (المهام 1–5): ${formatNumber(step.result.usage?.total_tokens ?? 0, locale)} وحدة · ${(step.result.elapsed_ms / 1000).toFixed(1)} ثانية`
                              : `0 units · 0.0s for this step · Pack total (Tasks 1–5): ${formatNumber(step.result.usage?.total_tokens ?? 0, locale)} units · ${(step.result.elapsed_ms / 1000).toFixed(1)}s`)
                            : `${step.result.usage ? `${formatNumber(step.result.usage.total_tokens, locale)} ${ar ? "وحدة" : "units"}` : (ar ? "لم تُبلَّغ الوحدات" : "Usage not reported")} · ${ar ? `${formatNumber(Number((step.result.elapsed_ms / 1000).toFixed(1)), locale)} ثوانٍ` : `${(step.result.elapsed_ms / 1000).toFixed(1)}s`}`}</span>
                          <details><summary>{ar ? "الإصدار والمصدر" : "Version & source lineage"}</summary><p>{ar ? "المهمة" : "Task"}: {step.task_id}</p><p>{ar ? "النتيجة" : "Result"}: {step.response_hash}</p><p>{ar ? "الإجراء" : "Procedure"}: {step.result.procedure_version}</p><p>{ar ? "المهام المصدر السابقة" : "Prior source tasks"}: {step.result.source_tasks.length}</p></details>
                        </footer>
                      </> : <div className="aw-task-empty"><FileText size={28} /><h3>{step.status === "in_progress" ? (ar ? "مختصك يكتب المسودة" : "Your specialist is drafting") : step.status === "failed" ? (ar ? "تحتاج هذه المهمة إلى انتباه" : "This task needs attention") : (ar ? "بانتظار دورها" : "Waiting for its turn")}</h3><p>{step.status === "in_progress" ? (ar ? "يستخدم العامل الموجز المحفوظ والمخرجات السابقة، وستظهر النتيجة الكاملة هنا بعد حفظها." : "The worker is using the saved brief and prior deliverables. The complete result will appear here when it has been stored.") : step.status === "failed" ? reason(step.error_code) : (ar ? "يبدأ هذا المختص بعد تسليم المهمة السابقة عملها. لا يُحاكى أي نشاط." : "This specialist starts after the preceding task has delivered its work. No activity is simulated.")}</p></div>}
                    </> : null}
                    {tab === "context" ? <div className="aw-context"><h3>{ar ? "الموجز نفسه عبر الفريق" : "The same brief, carried through the team"}</h3><p className="aw-muted">{ar ? "تبقى حقائق المالك منفصلة عن مقترحات النموذج، وهذه السجلات تخص هذه المهمة وحدها." : "Owner-supplied facts remain separate from model proposals. These records belong only to this assignment."}</p><details open><summary>{ar ? "الموجز الأصلي" : "Original brief"}</summary><p className="aw-prose" dir="auto">{selected.brief}</p></details><details open><summary>{ar ? "حقائق المصدر من المالك" : "Owner-supplied source facts"}</summary><p className="aw-prose" dir="auto">{selected.source_facts}</p></details><h3>{ar ? "المخرجات المسلّمة إلى هذا المختص" : "Deliverables passed to this specialist"}</h3>{step?.shared_context?.length ? step.shared_context.map((m) => <details key={m.task_id}><summary>{who(m.profile)} · {ar ? "مقترح غير معتمد" : "unapproved proposal"}</summary><p className="aw-prose" dir="auto">{m.document}</p><small>{ar ? "المهمة المصدر" : "Source task"}: {m.task_id}</small></details>) : <p className="aw-muted">{ar ? "لم تُسلَّم أي مخرجات سابقة لهذه المهمة. يعمل المختص الأول من الموجز الأصلي." : "No prior deliverables were passed to this task. The first specialist works from the original brief."}</p>}</div> : null}
                    {tab === "history" ? <ol className="aw-history">{selected.events.map((e) => <li key={e.id}><span className="aw-event-dot" /><div><strong>{e.actor_kind === "worker" ? who(e.actor_ref) : (ar ? "إنسان" : "Human")} · {e.event_type.replaceAll("_", " ")}</strong><time dateTime={e.occurred_at}>{date(e.occurred_at, locale)}</time>{e.evidence.feedback ? <p>{e.evidence.feedback}</p> : null}{e.event_type === "failed" ? <p>{reason(e.evidence.error ?? e.evidence.reason ?? null)}</p> : null}{e.evidence.sequence ? <p>{ar ? `استُلمت المهمة ${e.evidence.sequence} بسياق المهمة المشترك.` : `Task ${e.evidence.sequence} claimed with the shared assignment context.`}</p> : null}</div></li>)}</ol> : null}
                  </section>
                </div>
              </div>
            </>}
            {selected.status === "waiting_review" ? <section className="aw-review"><h3>{ar ? "قرارك يُكمل هذه المهمة" : "Your decision completes this assignment"}</h3><p>{ar ? "راجع كل مخرج أعلاه. الاعتماد يقبل هذه الحزمة تحديداً، ولا ينشر محتوى ولا يرسل رسائل ولا يعتمد حقائق أعمال ناقصة." : "Review every deliverable above. Approval records acceptance of this exact pack only—it does not publish content, send messages, or approve missing business facts."}</p>{selected.review_corrections?.needs_changes ? <div className="aw-corrections-blocked" role="status"><strong>{ar ? "يحتاج إلى تعديل — تعديلات مدقّق الهوية لم تُطبَّق بعد" : "Needs changes — Brand Guardian corrections are not yet applied"}</strong><p>{ar ? "أدرج مدقّق الهوية تعديلات تعذّر تطبيقها تلقائيًا على النص، لذلك يبقى الاعتماد موقوفًا حتى تُطلب التعديلات وتُنشأ نسخة منقّحة." : "Brand Guardian listed corrections that could not be applied automatically. Approval is held until changes are requested and resolved in a revised pack."}</p>{selected.review_corrections.unresolved.length ? <ul>{selected.review_corrections.unresolved.map((item) => <li key={item.id}>{item.exact}</li>)}</ul> : null}</div> : null}{data.can_review ? <><p className="aw-review-hint">{ar ? "للاكتفاء بالنتيجة اضغط «اعتماد حزمة العمل». ولطلب تعديل، اكتب ملاحظة قصيرة (3 أحرف على الأقل) في المربع أعلاه لتفعيل زر «طلب تعديلات»." : "Click “Approve work pack” to accept, or type at least 3 characters of feedback above to enable “Request changes”."}</p><label>{ar ? "ملاحظات المراجعة" : "Review feedback"}<textarea ref={feedbackRef} rows={3} maxLength={2000} value={feedback} onChange={(e) => { setFeedback(e.target.value); setFeedbackHint(false); }} placeholder={ar ? "مطلوبة عند طلب التعديل، واختيارية عند الاعتماد." : "Required when requesting changes; optional when approving."} /></label>{feedbackHint ? <p className="aw-review-hint aw-review-hint-error" role="status">{ar ? "اكتب 3 أحرف على الأقل في ملاحظات المراجعة لتفعيل «طلب تعديلات»." : "Type at least 3 characters of feedback to enable “Request changes”."}</p> : null}<div className="aw-actions"><button className="button button-primary" disabled={busy || Boolean(selected.review_corrections?.needs_changes)} onClick={() => void command({ action: "approve", id: selected.id, result_hash: selected.result_hash, feedback })}><Check size={17} />{ar ? "اعتماد حزمة العمل" : "Approve work pack"}</button><button className="button button-secondary" disabled={busy} onClick={() => { if (feedback.trim().length < 3) { setFeedbackHint(true); feedbackRef.current?.focus(); return; } setConfirmingReject(true); }}><X size={17} />{ar ? "طلب تعديلات" : "Request changes"}</button></div>
              {confirmingReject ? <div className="aw-reject-confirm" role="group" aria-label={ar ? "تأكيد طلب التعديل" : "Confirm change request"}>
                <p role="status">{ar ? "هل تريد تأكيد إرسال طلب التعديل وتغيير حالة الحزمة إلى «طُلب التعديل»؟" : "Confirm sending this change request and marking the work pack as “Changes requested”?"}</p>
                <div className="aw-actions">
                  <button className="button button-primary" disabled={busy} onClick={() => { setConfirmingReject(false); void command({ action: "reject", id: selected.id, result_hash: selected.result_hash, feedback }); }}><X size={17} />{ar ? "تأكيد طلب التعديل" : "Confirm change request"}</button>
                  <button className="button button-secondary" disabled={busy} onClick={() => setConfirmingReject(false)}>{ar ? "تراجع" : "Cancel"}</button>
                </div>
              </div> : null}</> : <p>{ar ? "يجب أن يتخذ القرار مالك أو مراجع." : "An owner or reviewer must make this decision."}</p>}</section> : null}
            {["approved", "rejected"].includes(selected.status) ? <section className="aw-decision-summary" aria-label={ar ? "قرار الحزمة" : "Pack decision"}>
              <h3>{ar ? "قرار هذه الحزمة" : "Decision on this work pack"}</h3>
              <p><span className={`aw-state aw-state-${selected.status}`}>{stateLabel(selected.status)}</span></p>
              <p>{selected.status === "approved"
                ? (ar ? "سُجّل اعتمادك لهذه الحزمة تحديداً، ولم يُنشر أي محتوى ولم تُرسل أي رسائل." : "Your approval is recorded for this exact pack. Nothing was published or sent.")
                : (ar ? "سُجّل طلب التعديل لهذه الحزمة، وبقيت مسوداتها محفوظة كما هي." : "The change request is recorded for this pack, and its drafts are preserved as they are.")}</p>
              <p>{ar ? "لإجراء تعديلات بعد قرار نهائي، اضغط «موجز حملة جديد» لبدء موجز منقّح." : "To make further edits after a final decision, click “New campaign brief” to start a revised brief."}</p>
            </section> : null}
            {data.can_manage && !["approved", "rejected", "cancelled"].includes(selected.status) ? <details className="aw-cancel"><summary>{ar ? "خيارات المهمة" : "Assignment controls"}</summary><p>{ar ? "ألغِ العمل المتبقي مع الحفاظ على المستندات المكتملة والسجل. قد يكتمل طلب وصل Gemini فعلاً." : "Cancel remaining work while preserving completed documents and history. A request already reaching Gemini may still finish remotely."}</p><button className="button button-secondary" disabled={busy} onClick={() => void command({ action: "cancel", id: selected.id })}>{ar ? "إلغاء العمل المتبقي" : "Cancel remaining work"}</button></details> : null}
          </> : <section className="aw-welcome"><UsersRound size={32} /><h2>{ar ? "الفريق الفعّال يبدأ بموجز واضح." : "A working team starts with a clear brief."}</h2><p>{ar ? "اختر حزمة عمل الحملة لتسليم مهمة عبر الاستراتيجية والمحتوى ومراجعة العلامة والاستكشاف والدعم وملخص التسليم. أو اختر مختصاً واحداً لمهمة مركّزة." : "Choose the Campaign Work Pack to hand an assignment through strategy, content, brand review, discovery, support, and a delivery summary. Or select one specialist for a focused task."}</p><p>{ar ? "تبقى كل نتيجة مرتبطة بمهمتها، ويمكنك فحص ما تمت مشاركته وتصدير العمل واتخاذ القرار النهائي." : "Each result stays attached to its task. You can inspect what was shared, export the work, and make the final decision."}</p>{data.can_manage ? <button className="button button-primary" onClick={newAssignment}><Plus size={17} />{ar ? "إنشاء أول مهمة" : "Create your first assignment"}</button> : <p>{ar ? "اطلب من المالك إنشاء مهمة." : "Ask an owner to create an assignment."}</p>}</section>}
        </section>
      </div>
    </> : null}
  </div>;
}
