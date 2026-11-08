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
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";
import { PageHeading } from "./page-heading";
import { StatusPill } from "./status-pill";

interface ApprovalItem {
  id: string;
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
}

type LoadState = "loading" | "ready" | "error";

function itemTitle(item: ApprovalItem) {
  const firstLine = item.draft_copy.split(/[.!?\n]/)[0]?.trim();
  return firstLine && firstLine.length <= 68
    ? firstLine
    : `${item.channel} ${item.content_type.replaceAll("_", " ")}`;
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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
  const activeIndex = active ? items.findIndex((item) => item.id === active.id) : -1;

  function select(id: string) {
    setActiveId(id);
    syncUrl(id);
  }

  function move(offset: number) {
    if (!items.length) return;
    const nextIndex = (activeIndex + offset + items.length) % items.length;
    select(items[nextIndex].id);
    setRejecting(false);
    setReason("");
  }

  async function decide(decision: "approved" | "rejected") {
    if (!active || (decision === "rejected" && !reason.trim())) return;
    setSubmitting(true);
    setFeedback("");
    try {
      const response = await authenticatedFetch(`/api/approvals/${active.id}/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          decision,
          rejection_reason: decision === "rejected" ? reason.trim() : null,
        }),
      });
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
      ? `${items.length} عنصر محتوى بحاجة إلى قرار قبل النشر.`
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
            <div className="inbox-heading"><h2>{ar ? "قائمة المراجعة" : "Review queue"}</h2><span>{items.length} {ar ? "قيد الانتظار" : "pending"}</span></div>
            <div className="review-list">
              {items.map((item) => (
                <button key={item.id} type="button" className={`review-list-item ${active.id === item.id ? "review-list-item-active" : ""}`} onClick={() => select(item.id)}>
                  <span className="channel-tile" aria-hidden="true">{item.channel.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{itemTitle(item)}</strong><small>{item.channel} · {formatCreatedAt(item.created_at)}</small></span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          </aside>

          <article className="review-canvas" aria-labelledby="review-title">
            <header className="review-header">
              <div><StatusPill tone="attention">{ar ? "بحاجة إلى مراجعة" : "Needs review"}</StatusPill><h2 id="review-title" dir="auto">{itemTitle(active)}</h2><p>{active.content_type.replaceAll("_", " ")} · {active.campaign_name}</p></div>
              <div className="review-position"><button className="icon-button" type="button" aria-label={ar ? "العنصر السابق" : "Previous item"} onClick={() => move(-1)}><ChevronLeft size={19} /></button><span>{activeIndex + 1} {ar ? "من" : "of"} {items.length}</span><button className="icon-button" type="button" aria-label={ar ? "العنصر التالي" : "Next item"} onClick={() => move(1)}><ChevronRight size={19} /></button></div>
            </header>

            <dl className="review-metadata">
              <div><dt>{ar ? "القناة" : "Channel"}</dt><dd>{active.channel}</dd></div>
              <div><dt>{ar ? "أُنشئ" : "Created"}</dt><dd>{formatCreatedAt(active.created_at)}</dd></div>
              <div><dt>{ar ? "أعدّه" : "Prepared by"}</dt><dd>{ar ? "منتج المحتوى" : "Content Producer"}</dd></div>
              <div><dt>{ar ? "سياسة الاعتماد" : "Approval policy"}</dt><dd>{ar ? "مراجعة بشرية مطلوبة" : "Human required"}</dd></div>
            </dl>

            <section className="content-preview" aria-labelledby="draft-copy-title">
              <div className="content-preview-heading"><h3 id="draft-copy-title">{ar ? "نص المسودة" : "Draft copy"}</h3><span>{ar ? "النسخة" : "Version"} {active.generation}</span></div>
              <p dir="auto">{active.draft_copy}</p>
            </section>

            <section className="media-brief" aria-labelledby="media-brief-title">
              <MessageSquareText size={19} />
              <div><h3 id="media-brief-title">{ar ? "الموجز الإعلامي" : "Media brief"}</h3><p dir="auto">{active.media_brief}</p></div>
            </section>

            <section className="decision-history" aria-labelledby="decision-history-title">
              <h3 id="decision-history-title">{ar ? "سياق القرار" : "Decision context"}</h3>
              <p><Clock3 size={16} /> {ar ? `نسخة الاستراتيجية ${active.strategy_version}. لم يُسجَّل أي قرار لهذا التوليد.` : `Strategy version ${active.strategy_version}. No decision has been recorded for this generation.`}</p>
            </section>

            {rejecting ? (
              <div className="rejection-panel" role="region" aria-labelledby="rejection-title">
                <div><h3 id="rejection-title">{ar ? "ما الذي يجب تغييره؟" : "What should change?"}</h3><p>{ar ? "يصبح سببك سياقاً للنسخة التالية." : "Your reason becomes context for the next generated version."}</p></div>
                <label htmlFor="rejection-reason">{ar ? "سبب الرفض" : "Rejection reason"}</label>
                <textarea id="rejection-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={ar ? "كن محدداً بشأن النبرة أو الادعاءات أو الجمهور أو تعديلات الوسائط المطلوبة." : "Be specific about tone, claims, audience, or required media changes."} />
                <div className="decision-actions"><button className="ghost-button" type="button" onClick={() => setRejecting(false)} disabled={submitting}>{ar ? "متابعة المراجعة" : "Keep reviewing"}</button><button className="danger-button" type="button" disabled={!reason.trim() || submitting} onClick={() => void decide("rejected")}><RotateCcw size={17} /> {submitting ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "ارفض وأعد التوليد" : "Reject and regenerate")}</button></div>
              </div>
            ) : (
              <footer className="review-footer">
                <p>{ar ? "يبقى النشر محظوراً حتى تعتمد هذه النسخة." : "Publishing remains blocked until you approve this version."}</p>
                <div className="decision-actions"><button className="ghost-button" type="button" onClick={() => setRejecting(true)} disabled={submitting}><X size={17} /> {ar ? "طلب تعديلات" : "Request changes"}</button><button className="primary-button" type="button" onClick={() => void decide("approved")} disabled={submitting}><Check size={17} /> {submitting ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "اعتماد المحتوى" : "Approve content")}</button></div>
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
      <div><h2 id="approval-empty-title">{ar ? "قائمة الاعتماد فارغة" : "Approval queue is clear"}</h2><p>{feedback || (ar ? "لا يوجد محتوى بانتظار قرار بشري. ستظهر المسودات الجديدة هنا عندما يسلّمها منتج المحتوى." : "There is no content waiting for a human decision. New drafts will appear here when the Content Producer submits them.")}</p></div>
      <a className="secondary-button" href="/content">{ar ? "فتح مكتبة المحتوى" : "Open Content Library"}</a>
      <span className="approval-state-meta">{ar ? "يبقى النشر محمياً بسياسة الاعتماد في قاعدة البيانات." : "Publishing remains protected by the database approval policy."}</span>
    </section>
  );
}
