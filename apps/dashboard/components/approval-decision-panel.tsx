"use client";

import { Check, RotateCcw } from "lucide-react";

export const MIN_FEEDBACK = 3;

export function canRequestChanges(reason: string, submitting: boolean): boolean {
  return !submitting && reason.trim().length >= MIN_FEEDBACK;
}

export function ApprovalDecisionPanel({
  ar,
  source,
  reason,
  onReasonChange,
  submitting,
  approvalBlocked,
  onApprove,
  onRequestChanges,
}: {
  ar: boolean;
  source: "ai_workspace" | "content";
  reason: string;
  onReasonChange: (value: string) => void;
  submitting: boolean;
  approvalBlocked: boolean;
  onApprove: () => void;
  onRequestChanges: () => void;
}) {
  const feedbackReady = reason.trim().length >= MIN_FEEDBACK;
  const actionName = source === "ai_workspace"
    ? (ar ? "طلب تعديلات" : "Request changes")
    : (ar ? "ارفض وأعد التوليد" : "Reject and regenerate");
  const rejectLabel = submitting
    ? (ar ? "جارٍ الحفظ…" : "Saving…")
    : actionName;
  const approveLabel = submitting
    ? (ar ? "جارٍ الحفظ…" : "Saving…")
    : source === "ai_workspace"
      ? (ar ? "اعتماد حزمة العمل" : "Approve work pack")
      : (ar ? "اعتماد المحتوى" : "Approve content");

  return (
    <section className="review-decision-panel" aria-labelledby="review-feedback-title">
      <div className="review-decision-head">
        <h3 id="review-feedback-title">{ar ? "قرارك يعتمد هذا العنصر" : "Your decision"}</h3>
        <p>
          {ar
            ? `للاكتفاء بالنتيجة اضغط «اعتماد»، ولطلب تعديل اكتب ملاحظة لا تقل عن 3 أحرف لتفعيل زر «${actionName}».`
            : `Approve to accept as-is, or type at least 3 characters of feedback above the actions to enable “${actionName}”.`}
        </p>
      </div>

      <label htmlFor="rejection-reason">{ar ? "ملاحظات المراجعة" : "Review feedback"}</label>
      <textarea
        id="rejection-reason"
        rows={3}
        maxLength={2000}
        value={reason}
        onChange={(event) => onReasonChange(event.target.value)}
        placeholder={
          ar
            ? "مطلوبة عند طلب التعديل (3 أحرف على الأقل)، واختيارية عند الاعتماد."
            : "Required when requesting changes (at least 3 characters); optional when approving."
        }
      />
      {!feedbackReady ? (
        <p className="review-feedback-hint" role="status">
          {ar
            ? `اكتب 3 أحرف على الأقل في ملاحظات المراجعة لتفعيل «${actionName}».`
            : `Type at least 3 characters of feedback to enable “${actionName}”.`}
        </p>
      ) : null}

      <footer className="review-footer">
        <p>
          {approvalBlocked
            ? (ar
              ? "يحتاج إلى تعديل — أدرج مدقّق الهوية تعديلات غير مطبّقة؛ اطلب تعديلات قبل الاعتماد."
              : "Needs changes — Brand Guardian listed unapplied corrections; request changes before approving.")
            : (ar
              ? "يبقى النشر محظوراً حتى تعتمد هذه النسخة."
              : "Publishing remains blocked until you approve this version.")}
        </p>
        <div className="decision-actions">
          <button
            className="danger-button"
            type="button"
            disabled={!canRequestChanges(reason, submitting)}
            onClick={onRequestChanges}
          >
            <RotateCcw size={17} /> {rejectLabel}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={submitting || approvalBlocked}
            onClick={onApprove}
          >
            <Check size={17} /> {approveLabel}
          </button>
        </div>
      </footer>
    </section>
  );
}
