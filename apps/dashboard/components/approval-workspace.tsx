"use client";

import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { formatArabicCount, formatDateTime } from "@/lib/i18n/format";
import { useLocale } from "@/lib/client/use-locale";
import { agentDeliverableLabel, agentDisplayName } from "@/lib/i18n/agent-names";
import { dialectLabel, normalizeDialect } from "@/lib/i18n/dialects";
import { FormattedText } from "./formatted-text";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

interface WorkspaceDeliverable {
  sequence: number;
  profile: string;
  status: string;
  excerpt: string;
  document?: string;
}

interface ApprovalItem {
  id: string;
  source: "content" | "ai_workspace";
  campaign_id: string;
  campaign_name: string;
  channel: string;
  content_type: string;
  draft_copy: string;
  media_brief: string;
  media_url: string | null;
  generation: number;
  strategy_version: number;
  created_at: string;
  title: string | null;
  language: "en" | "ar" | null;
  dialect: string | null;
  result_hash: string | null;
  deliverables: WorkspaceDeliverable[];
  review_needs_changes?: boolean;
  review_unresolved_count?: number;
}

type LoadState = "loading" | "ready" | "error";

const profileNames: Record<string, string> = {
  social_media_strategist: "Social Media Strategist",
  content_creator: "Content Creator",
  brand_guardian: "Brand Guardian",
  discovery_coach: "Discovery Coach",
  support_responder: "Support Responder",
  executive_summary: "Executive Summary",
};

const profileDeliverables: Record<string, string> = {
  social_media_strategist: "Social media plan",
  content_creator: "Campaign copy",
  brand_guardian: "Brand review",
  discovery_coach: "Discovery questions",
  support_responder: "Support replies",
  executive_summary: "Delivery summary",
};

function itemTitle(item: ApprovalItem) {
  if (item.source === "ai_workspace") return item.title || item.campaign_name;
  const firstLine = item.draft_copy.split(/[.!?\n]/)[0]?.trim();
  return firstLine && firstLine.length <= 68
    ? firstLine
    : `${item.channel} ${item.content_type.replaceAll("_", " ")}`;
}

function formatCreatedAt(value: string, ar: boolean) {
  return formatDateTime(value, ar ? "ar" : "en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

const MIN_FEEDBACK = 3;

const contentTypeLabelsAr: Record<string, string> = {
  work_pack: "حزمة عمل",
  social_post: "منشور اجتماعي",
  blog_post: "مقال",
  email: "بريد إلكتروني",
  caption: "نص منشور",
};

function contentTypeLabel(value: string, ar: boolean) {
  const spaced = value.replaceAll("_", " ");
  return ar ? contentTypeLabelsAr[value] || spaced : spaced;
}

const deliverableStatusesAr: Record<string, string> = {
  draft: "مسودة",
  pending: "قيد الانتظار",
  approved: "معتمد",
  rejected: "مرفوض",
  changes_requested: "طُلب التعديل",
  failed: "يحتاج إلى انتباه",
};

function deliverableStatus(value: string, ar: boolean) {
  const spaced = value.replaceAll("_", " ");
  return ar ? deliverableStatusesAr[value] || spaced : spaced;
}

/** The full document often repeats the deliverable heading already shown above
 *  it, so drop a leading heading that only repeats the visible label. */
function withoutDuplicateHeading(document: string, labels: Array<string | undefined>) {
  const lines = document.split(/\r?\n/);
  const first = lines[0]?.trim() ?? "";
  if (!first) return document;
  const heading = first.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/[:：]\s*$/, "").trim().toLowerCase();
  if (!heading) return document;
  const duplicate = labels.some((label) => label && label.replaceAll("_", " ").trim().toLowerCase() === heading);
  return duplicate ? lines.slice(1).join("\n").trim() || document : document;
}

function requestedId() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || params.get("item") || "";
}

function syncUrl(id: string) {
  if (typeof window === "undefined" || !id) return;
  window.history.replaceState(null, "", `/approvals?id=${encodeURIComponent(id)}`);
}

export function ApprovalWorkspace() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "ai_workspace" | "content">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "title">("newest");

  const load = useCallback(async () => {
    setLoadState("loading");
    setFeedback("");
    try {
      const response = await authenticatedFetch("/api/approvals", { cache: "no-store" });
      if (response.status === 401) return;
      if (!response.ok) throw new Error("approval request failed");
      const payload = await response.json() as { items: ApprovalItem[] };
      const requested = requestedId();
      setItems(payload.items);
      setActiveId((current) => payload.items.some((item) => item.id === current)
        ? current
        : payload.items.some((item) => item.id === requested)
          ? requested
          : payload.items[0]?.id ?? "");
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const active = useMemo(
    () => items.find((item) => item.id === activeId) ?? items[0],
    [activeId, items],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const matchesSource = sourceFilter === "all" || item.source === sourceFilter;
      const haystack = `${itemTitle(item)} ${item.campaign_name} ${item.channel} ${item.content_type}`.toLowerCase();
      return matchesSource && (!needle || haystack.includes(needle));
    });
    return [...filtered].sort((a, b) => sort === "title"
      ? itemTitle(a).localeCompare(itemTitle(b), locale)
      : sort === "oldest"
        ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [items, locale, query, sort, sourceFilter]);

  useEffect(() => {
    if (!visible.length) return;
    if (!active || !visible.some((item) => item.id === active.id)) {
      setActiveId(visible[0].id);
      syncUrl(visible[0].id);
    }
  }, [active, visible]);

  const activeIndex = active ? visible.findIndex((item) => item.id === active.id) : -1;

  function select(id: string) {
    setActiveId(id);
    syncUrl(id);
  }

  function move(offset: number) {
    if (!visible.length) return;
    const nextIndex = (activeIndex + offset + visible.length) % visible.length;
    select(visible[nextIndex].id);
    setRejecting(false);
    setReason("");
  }

  async function decide(decision: "approved" | "rejected") {
    if (!active || (decision === "rejected" && reason.trim().length < MIN_FEEDBACK)) return;
    setSubmitting(true);
    setFeedback("");
    try {
      const workspaceItem = active.source === "ai_workspace";
      const response = await authenticatedFetch(
        workspaceItem ? "/api/workspace" : `/api/approvals/${active.id}/decision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: workspaceItem
            ? JSON.stringify({
              action: decision === "approved" ? "approve" : "reject",
              id: active.id,
              result_hash: active.result_hash,
              feedback: reason.trim(),
            })
            : JSON.stringify({
              decision,
              rejection_reason: decision === "rejected" ? reason.trim() : null,
            }),
        },
      );
      if (response.status === 401) return;
      if (!response.ok) throw new Error("decision failed");
      const nextItems = items.filter((item) => item.id !== active.id);
      setItems(nextItems);
      const nextId = nextItems[Math.min(activeIndex, nextItems.length - 1)]?.id ?? "";
      setActiveId(nextId);
      if (nextId) syncUrl(nextId);
      setRejecting(false);
      setReason("");
      setFeedback(decision === "approved"
        ? (ar ? "تم حفظ الاعتماد، والعنصر متاح الآن في مكتبة المحتوى." : "Approval saved. The item is now available in the Content Library.")
        : (ar ? "طُلب التعديل، وأُضيفت مهمة إعادة التوليد إلى قائمة الانتظار." : "Changes requested. Regeneration work has been queued."));
    } catch {
      setFeedback(ar ? "لم يُحفظ القرار. يبقى العنصر محظوراً؛ حاول مرة أخرى." : "The decision was not saved. The item remains blocked; please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const description = loadState === "ready"
    ? (ar
      ? `${formatArabicCount(items.length, { zero: "لا عناصر محتوى بحاجة إلى قرار قبل النشر.", one: "عنصر محتوى واحد بحاجة إلى قرار قبل النشر.", two: "عنصرا محتوى بحاجة إلى قرار قبل النشر.", few: "{count} عناصر محتوى بحاجة إلى قرار قبل النشر.", many: "{count} عنصر محتوى بحاجة إلى قرار قبل النشر.", other: "{count} عنصر محتوى بحاجة إلى قرار قبل النشر." })}`
      : `${items.length} content ${items.length === 1 ? "item needs" : "items need"} a decision before publishing.`)
    : (ar ? "راجع المحتوى قبل أن تتقدم أي أعمال نشر." : "Review content before any publishing work can move forward.");

  return (
    <div className="page-stack">
      <PageHeading title={ar ? "الاعتمادات" : "Approvals"} description={description} />
      <p className="sr-only" role="status" aria-live="polite">{feedback}</p>

      {loadState === "loading" ? <ApprovalLoadingState /> : null}
      {loadState === "error" ? <ApprovalErrorState retry={load} ar={ar} /> : null}
      {loadState === "ready" && !items.length ? <ApprovalEmptyState feedback={feedback} ar={ar} /> : null}

      {loadState === "ready" && active ? (
        <div className="approval-workspace">
          <aside className="review-inbox" aria-label={ar ? "محتوى بانتظار المراجعة" : "Content awaiting review"}>
            <div className="inbox-heading"><h2>{ar ? "قائمة المراجعة" : "Review queue"}</h2><span>{ar ? formatArabicCount(items.length, { zero: "لا عناصر", one: "عنصر واحد", two: "عنصران", few: "{count} عناصر", many: "{count} عنصرًا", other: "{count} عنصر" }) : `${items.length} pending`}</span>            </div>
            <div className="list-toolbar list-toolbar-compact">
              <label className="search-field">
                <Search size={16} />
                <span className="sr-only">{ar ? "ابحث في قائمة المراجعة" : "Search the review queue"}</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={ar ? "ابحث بالعنوان أو الحملة" : "Search title, campaign, or channel"} />
              </label>
              <div className="list-toolbar-selects">
                <label className="list-select"><span>{ar ? "النوع" : "Type"}</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as "all" | "ai_workspace" | "content")}><option value="all">{ar ? "كل الأنواع" : "All types"}</option><option value="ai_workspace">{ar ? "حزم العمل" : "AI work packs"}</option><option value="content">{ar ? "المحتوى" : "Content items"}</option></select></label>
                <label className="list-select"><span>{ar ? "الترتيب" : "Sort"}</span><select value={sort} onChange={(event) => setSort(event.target.value as "newest" | "oldest" | "title")}><option value="newest">{ar ? "الأحدث أولاً" : "Newest first"}</option><option value="oldest">{ar ? "الأقدم أولاً" : "Oldest first"}</option><option value="title">{ar ? "العنوان أبجديًا" : "Title A–Z"}</option></select></label>
              </div>
            </div>
            {!visible.length ? <p className="list-filter-empty">{ar ? "لا عناصر تطابق هذا العرض. امسح البحث أو غيّر النوع." : "No items match this view. Clear the search or change the type."}</p> : null}
            <div className="review-list">
              {visible.map((item) => (
                <button key={item.id} type="button" className={`review-list-item ${active.id === item.id ? "review-list-item-active" : ""}`} onClick={() => select(item.id)}>
                  <span className="channel-tile" aria-hidden="true">{item.source === "ai_workspace" ? "AI" : item.channel.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{itemTitle(item)}</strong><small>{item.source === "ai_workspace" ? (ar ? "مساحة الذكاء الاصطناعي" : "AI workspace") : item.channel} · {formatCreatedAt(item.created_at, ar)}</small></span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          </aside>

          <article className="review-canvas" aria-labelledby="review-title">
            <header className="review-header">
              <div><StatusPill tone="attention">{ar ? "بحاجة إلى مراجعة" : "Needs review"}</StatusPill><h2 id="review-title" dir="auto">{itemTitle(active)}</h2><p>{active.source === "ai_workspace" ? (ar ? "حزمة عمل من مساحة الذكاء الاصطناعي" : "AI workspace work pack") : contentTypeLabel(active.content_type, ar)} · {active.campaign_name}</p></div>
              <div className="review-position"><button className="icon-button" type="button" aria-label={ar ? "العنصر السابق" : "Previous item"} onClick={() => move(-1)}><ChevronLeft size={19} /></button><span>{ar ? `${activeIndex + 1} من ${visible.length}` : `${activeIndex + 1} of ${visible.length}`}</span><button className="icon-button" type="button" aria-label={ar ? "العنصر التالي" : "Next item"} onClick={() => move(1)}><ChevronRight size={19} /></button></div>
            </header>

            <dl className="review-metadata">
              <div><dt>{ar ? "القناة" : "Channel"}</dt><dd>{active.source === "ai_workspace" ? (ar ? "مساحة الذكاء الاصطناعي" : "AI workspace") : active.channel}</dd></div>
              <div><dt>{ar ? "أُنشئ" : "Created"}</dt><dd>{formatCreatedAt(active.created_at, ar)}</dd></div>
              <div><dt>{ar ? "أعدّه" : "Prepared by"}</dt><dd>{active.source === "ai_workspace" ? (ar ? "فريق المختصين" : "Specialist team") : (ar ? "كاتب المحتوى" : "Content Producer")}</dd></div>
              <div><dt>{ar ? "سياسة الاعتماد" : "Approval policy"}</dt><dd>{ar ? "مراجعة بشرية مطلوبة" : "Human required"}</dd></div>
              {active.source === "ai_workspace" ? <div><dt>{ar ? "اللغة واللهجة" : "Language & dialect"}</dt><dd>{active.language === "ar" ? (ar ? "العربية" : "Arabic") : (ar ? "الإنجليزية" : "English")}{normalizeDialect(active.dialect) ? ` · ${dialectLabel(normalizeDialect(active.dialect)!, locale)}` : ""}</dd></div> : null}
            </dl>

            {active.source === "ai_workspace" ? (
              <section className="content-preview" aria-labelledby="draft-copy-title">
                <div className="content-preview-heading"><h3 id="draft-copy-title">{ar ? "المخرجات الستة" : "Six deliverables"}</h3><span>{ar ? "مسودات غير معتمدة" : "Unapproved drafts"}</span></div>
                {active.deliverables.length ? <ul className="approval-deliverables">{active.deliverables.map((deliverable) => (
                  <li key={`${deliverable.sequence}-${deliverable.profile}`}>
                    <strong>{agentDisplayName(profileNames[deliverable.profile] || deliverable.profile, ar)}</strong>
                    <small dir="auto">{agentDeliverableLabel(profileDeliverables[deliverable.profile] || deliverable.profile, ar)} · {deliverableStatus(deliverable.status, ar)}</small>
                    {deliverable.excerpt ? <div className="approval-deliverable-excerpt">
                      <FormattedText text={`${deliverable.excerpt}${deliverable.document && deliverable.document.length > deliverable.excerpt.length ? "…" : ""}`} dir="auto" />
                      {deliverable.document && deliverable.document.length > deliverable.excerpt.length
                        ? <details className="approval-deliverable-full"><summary>{ar ? "اقرأ المخرج كاملاً" : "Read the full deliverable"}</summary><FormattedText text={withoutDuplicateHeading(deliverable.document, [profileNames[deliverable.profile], profileDeliverables[deliverable.profile], agentDeliverableLabel(profileDeliverables[deliverable.profile] || deliverable.profile, ar)])} dir="auto" /></details>
                        : null}
                    </div> : <p dir="auto">{ar ? "لا مسودة محفوظة بعد." : "No stored draft yet."}</p>}
                  </li>
                ))}</ul> : <p>{ar ? "لم يُسلَّم أي مخرج بعد." : "No deliverable has been stored yet."}</p>}
                <Link className="text-link" href={`/workspace?id=${active.id}`}>{ar ? "فتح حزمة العمل كاملة في مساحة الذكاء الاصطناعي" : "Open the full work pack in the AI workspace"} <ChevronRight size={16} /></Link>
              </section>
            ) : (
              <section className="content-preview" aria-labelledby="draft-copy-title">
                <div className="content-preview-heading"><h3 id="draft-copy-title">{ar ? "نص المسودة" : "Draft copy"}</h3><span>{ar ? "النسخة" : "Version"} {active.generation}</span></div>
                <p dir="auto">{active.draft_copy}</p>
              </section>
            )}

            <section className="media-brief" aria-labelledby="media-brief-title">
              <MessageSquareText size={19} />
              <div><h3 id="media-brief-title">{ar ? "توصيف الوسائط والتصميم" : "Media brief"}</h3><p dir="auto">{active.media_brief}</p></div>
            </section>

            <section className="decision-history" aria-labelledby="decision-history-title">
              <h3 id="decision-history-title">{ar ? "سياق القرار" : "Decision context"}</h3>
              {active.source === "ai_workspace"
                ? <p><Clock3 size={16} /> {ar ? "الاعتماد يقبل هذه الحزمة تحديداً. لا ينشر محتوى ولا يرسل رسائل ولا يعتمد حقائق أعمال ناقصة." : "Approval records acceptance of this exact pack only. It does not publish content, send messages, or approve missing business facts."}</p>
                : <p><Clock3 size={16} /> {ar ? `نسخة الاستراتيجية ${active.strategy_version}. لم يُسجَّل أي قرار لهذا التوليد.` : `Strategy version ${active.strategy_version}. No decision has been recorded for this generation.`}</p>}
            </section>

            {rejecting ? (
              <div className="rejection-panel" role="region" aria-labelledby="rejection-title">
                <div><h3 id="rejection-title">{ar ? "ما الذي يجب تغييره؟" : "What should change?"}</h3><p>{active.source === "ai_workspace" ? (ar ? "تُحفظ ملاحظاتك مع الحزمة، وأنشئ مهمة منقّحة لإنتاج نسخة جديدة." : "Your feedback is saved with the pack; create a revised assignment to produce a new version.") : (ar ? "يصبح سببك سياقاً للنسخة التالية." : "Your reason becomes context for the next generated version.")}</p></div>
                <label htmlFor="rejection-reason">{ar ? "سبب الرفض" : "Rejection reason"}</label>
                <textarea id="rejection-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={ar ? "كن محدداً بشأن النبرة أو الادعاءات أو الجمهور أو تعديلات الوسائط المطلوبة." : "Be specific about tone, claims, audience, or required media changes."} />
                {reason.trim().length < MIN_FEEDBACK ? <p className="review-feedback-hint" role="status">{ar ? "اكتب 3 أحرف على الأقل لتفعيل «طلب تعديلات»." : "Type at least 3 characters to enable “Request changes”."}</p> : null}
                <div className="decision-actions"><button className="ghost-button" type="button" onClick={() => setRejecting(false)} disabled={submitting}>{ar ? "متابعة المراجعة" : "Keep reviewing"}</button><button className="danger-button" type="button" disabled={reason.trim().length < MIN_FEEDBACK || submitting} onClick={() => void decide("rejected")}><RotateCcw size={17} /> {submitting ? (ar ? "جارٍ الحفظ…" : "Saving…") : active.source === "ai_workspace" ? (ar ? "طلب تعديلات" : "Request changes") : (ar ? "ارفض وأعد التوليد" : "Reject and regenerate")}</button></div>
              </div>
            ) : (
              <footer className="review-footer">
                <p>{active.review_needs_changes
                  ? (ar ? "يحتاج إلى تعديل — أدرج مدقّق الهوية تعديلات غير مطبّقة؛ اطلب تعديلات قبل الاعتماد." : "Needs changes — Brand Guardian listed unapplied corrections; request changes before approving.")
                  : (ar ? "يبقى النشر محظوراً حتى تعتمد هذه النسخة." : "Publishing remains blocked until you approve this version.")}</p>
                <div className="decision-actions"><button className="ghost-button" type="button" onClick={() => setRejecting(true)} disabled={submitting}><X size={17} /> {ar ? "طلب تعديلات" : "Request changes"}</button><button className="primary-button" type="button" onClick={() => void decide("approved")} disabled={submitting || Boolean(active.review_needs_changes)}><Check size={17} /> {submitting ? (ar ? "جارٍ الحفظ…" : "Saving…") : active.source === "ai_workspace" ? (ar ? "اعتماد حزمة العمل" : "Approve work pack") : (ar ? "اعتماد المحتوى" : "Approve content")}</button></div>
              </footer>
            )}
          </article>
        </div>
      ) : null}
    </div>
  );
}

function ApprovalLoadingState() {
  return (
    <div className="approval-workspace approval-loading" aria-label="Loading approval queue" aria-busy="true">
      <aside className="review-inbox"><div className="state-skeleton state-skeleton-short" /><div className="state-skeleton" /><div className="state-skeleton" /><div className="state-skeleton" /></aside>
      <div className="review-canvas"><div className="state-skeleton state-skeleton-title" /><div className="state-skeleton" /><div className="state-skeleton state-skeleton-block" /></div>
    </div>
  );
}

function ApprovalErrorState({ retry, ar }: { retry: () => Promise<void>; ar: boolean }) {
  return (
    <section className="approval-state approval-state-error" aria-labelledby="approval-error-title">
      <TriangleAlert size={25} aria-hidden="true" />
      <div><h2 id="approval-error-title">{ar ? "قائمة الاعتماد غير متاحة" : "The approval queue is unavailable"}</h2><p>{ar ? "لا يمكن اتخاذ أي قرار حتى يُستعاد الاتصال بمصدر الحقيقة." : "No decision can be made until the source-of-truth connection is restored."}</p></div>
      <button className="secondary-button" type="button" onClick={() => void retry()}><RefreshCw size={16} /> {ar ? "حاول مرة أخرى" : "Try again"}</button>
    </section>
  );
}

function ApprovalEmptyState({ feedback, ar }: { feedback: string; ar: boolean }) {
  return (
    <section className="approval-state approval-state-empty" aria-labelledby="approval-empty-title">
      <span className="approval-state-icon"><CheckCircle2 size={28} aria-hidden="true" /></span>
      <div><h2 id="approval-empty-title">{ar ? "قائمة الاعتماد فارغة" : "Approval queue is clear"}</h2><p>{feedback || (ar ? "لا يوجد محتوى بانتظار قرار بشري. ستظهر المسودات الجديدة هنا عندما يسلّمها كاتب المحتوى." : "There is no content waiting for a human decision. New drafts will appear here when the Content Producer submits them.")}</p></div>
      <a className="primary-button" href="/workspace">{ar ? "ابدأ موجز حملة" : "Start a campaign brief"}</a>
      <span className="approval-state-meta">{ar ? "يبقى النشر محمياً بسياسة الاعتماد في قاعدة البيانات." : "Publishing remains protected by the database approval policy."}</span>
    </section>
  );
}
