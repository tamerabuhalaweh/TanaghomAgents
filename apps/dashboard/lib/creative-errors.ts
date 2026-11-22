import type { CreativeLocale } from "@/lib/i18n/creative";

export interface ProductPresetOption {
  code: string;
  display: string;
}

/**
 * Built-in static preset list matching `config/creative-image-presets.v1.json`
 * so Product Studio keeps its preset controls usable if the preset endpoint is
 * temporarily unavailable.
 */
export const FALLBACK_PRODUCT_PRESETS: readonly ProductPresetOption[] = [
  { code: "clean_white", display: "Clean white" },
  { code: "marble", display: "Marble" },
  { code: "wood", display: "Wood" },
  { code: "office_studio", display: "Office studio" },
  { code: "outdoor_lifestyle", display: "Outdoor lifestyle" },
];

const CREATIVE_ERROR_COPY: Record<string, { en: string; ar: string }> = {
  image_generation_disabled: {
    en: "Image generation is not enabled on this environment, so scenes cannot be generated yet. The platform owner must connect an image provider. Product sources and cutouts still work.",
    ar: "توليد الصور غير مفعّل على هذه البيئة، لذا لا يمكن إنشاء المشاهد بعد. يجب على مالك المنصة ربط مزوّد الصور. تبقى مصادر المنتجات والقصّ متاحة.",
  },
  product_studio_disabled: {
    en: "Product scene generation is not enabled on this environment yet. Product sources and cutouts still work.",
    ar: "إنشاء مشاهد المنتجات غير مفعّل على هذه البيئة بعد. تبقى مصادر المنتجات والقصّ متاحة.",
  },
  creative_studio_disabled: {
    en: "Creative Studio is currently disabled on this workspace.",
    ar: "استوديو الإبداع معطّل حاليًا على مساحة العمل هذه.",
  },
  ml_segmentation_disabled: {
    en: "Automatic background removal is not enabled on this environment yet. Use the local cutout engine or a transparent source image.",
    ar: "الإزالة التلقائية للخلفية غير مفعّلة على هذه البيئة بعد. يمكنك استخدام المحرك المحلي أو صورة بخلفية شفافة.",
  },
  service_unavailable: {
    en: "This creative service is temporarily unavailable. Try again in a moment.",
    ar: "هذه الخدمة الإبداعية غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.",
  },
  request_failed: {
    en: "This creative service is temporarily unavailable. Try again in a moment.",
    ar: "هذه الخدمة الإبداعية غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.",
  },
  unauthorized: {
    en: "Your session expired. Sign in again to continue.",
    ar: "انتهت جلستك. سجّل الدخول مرة أخرى للمتابعة.",
  },
  forbidden: {
    en: "Your account does not have permission for this action.",
    ar: "لا يملك حسابك الصلاحية لتنفيذ هذا الإجراء.",
  },
  not_found: {
    en: "The requested creative item could not be found.",
    ar: "تعذّر العثور على العنصر الإبداعي المطلوب.",
  },
  source_not_found: {
    en: "The selected source image was not found in this workspace.",
    ar: "لم يتم العثور على الصورة المصدر المحددة في مساحة العمل هذه.",
  },
  open_job_limit_reached: {
    en: "You already have the maximum number of open creative jobs running. Wait for one to finish and try again.",
    ar: "لديك الحد الأقصى من المهام الإبداعية المفتوحة حاليًا. انتظر اكتمال إحداها ثم حاول مرة أخرى.",
  },
};

/**
 * Translates an internal API error code into customer-readable English/Arabic
 * copy, never surfacing raw internal codes or parenthesized error identifiers.
 */
export function creativeErrorMessage(code: string, locale: CreativeLocale): string {
  const entry = CREATIVE_ERROR_COPY[code];
  if (entry) return locale === "ar" ? entry.ar : entry.en;
  return locale === "ar"
    ? "تعذّر تحميل هذا القسم حاليًا. حاول مرة أخرى بعد قليل."
    : "We could not load this section right now. Try again in a moment.";
}
