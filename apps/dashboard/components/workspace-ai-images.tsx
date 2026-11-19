"use client";

export interface WorkspaceImageQuotaStatus {
  plan_tier: "starter" | "growth" | "scale" | null;
  is_sandbox: boolean;
  images_used: number;
  images_limit: number;
  month: string;
}

export interface WorkspacePostImageSummary {
  url: string;
  prompt_summary?: string | null;
}

function planLabel(quota: WorkspaceImageQuotaStatus, ar: boolean) {
  if (!quota.plan_tier) return ar ? "التجربة المجانية" : "Free Sandbox";
  if (ar) return ({ starter: "البداية", growth: "النمو", scale: "التوسع" } as Record<string, string>)[quota.plan_tier];
  return `${quota.plan_tier[0].toUpperCase()}${quota.plan_tier.slice(1)}`;
}

/** Exact monthly image copy shown in the workspace quota bar. */
export function imageQuotaText(quota: WorkspaceImageQuotaStatus, ar: boolean) {
  const plan = planLabel(quota, ar);
  if (quota.images_limit <= 0) {
    return ar
      ? `صور الذكاء الاصطناعي: غير مشمولة في باقة ${plan} (تُعرض بطاقات الهوية البصرية SVG/PNG)`
      : `AI images: 0 included on ${plan} (using brand-styled SVG/PNG cards)`;
  }
  return ar
    ? `صور الذكاء الاصطناعي: ${quota.images_used} من ${quota.images_limit} مستخدمة هذا الشهر`
    : `AI images: ${quota.images_used} of ${quota.images_limit} used this month`;
}

export function WorkspaceImageQuota({ quota, ar }: { quota: WorkspaceImageQuotaStatus | null | undefined; ar: boolean }) {
  if (!quota) return null;
  return <span className="aw-quota-images" role="status">{imageQuotaText(quota, ar)}</span>;
}

/** Maps the API image list onto the per-post card slots. */
export function postImageSlots(
  images: Array<{ post_index: number; status: string; url: string | null; prompt_summary?: string | null }> | null | undefined,
): Record<number, WorkspacePostImageSummary> | undefined {
  if (!images?.length) return undefined;
  const slots: Record<number, WorkspacePostImageSummary> = {};
  for (const image of images) {
    if (image.status !== "generated" || !image.url) continue;
    slots[image.post_index] = { url: image.url, prompt_summary: image.prompt_summary ?? null };
  }
  return Object.keys(slots).length ? slots : undefined;
}
