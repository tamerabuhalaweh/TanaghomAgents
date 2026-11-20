import "server-only";

type StarterLocale = "en" | "ar";
type LocalisedSpec = Record<string, unknown>;

// The platform starter templates are seeded in one language each, so the global
// gallery mixes English and Arabic placeholders. These tables give every starter
// a clean placeholder in the requested UI language; only node text is replaced,
// geometry, colours and roles stay exactly as seeded.
const STARTER_TEXT: Record<string, Record<StarterLocale, Record<string, string>>> = {
  "product-promo": {
    en: {
      "headline-1": "Product name",
      "body-1": "Short product description",
      "cta-1": "Order now",
    },
    ar: {
      "headline-1": "عنوان المنتج",
      "body-1": "وصف قصير للمنتج",
      "cta-1": "اطلب الآن",
    },
  },
  announcement: {
    en: {
      "headline-1": "Announcement",
      "body-1": "What is new in one sentence",
    },
    ar: {
      "headline-1": "إعلان",
      "body-1": "ما الجديد في جملة واحدة",
    },
  },
  quote: {
    en: {
      "body-1": "Quote text goes here",
      "caption-1": "Name",
    },
    ar: {
      "body-1": "نص الاقتباس هنا",
      "caption-1": "الاسم",
    },
  },
  tips: {
    en: {
      "headline-1": "Tip of the day",
      "body-1": "One practical tip in two lines",
    },
    ar: {
      "headline-1": "نصيحة اليوم",
      "body-1": "نصيحة عملية واحدة في سطرين",
    },
  },
  "event-course": {
    en: {
      "headline-1": "New course",
      "body-1": "Details and location",
      "cta-1": "Register now",
    },
    ar: {
      "headline-1": "دورة جديدة",
      "body-1": "التفاصيل والمكان",
      "cta-1": "سجّل الآن",
    },
  },
  "carousel-edu": {
    en: {
      "slide-1-headline": "Five common mistakes",
      "slide-2-headline": "Mistake one",
      "slide-2-body": "Explain the mistake here",
      "slide-3-headline": "Mistake two",
      "slide-3-body": "Explain the mistake here",
      "slide-4-headline": "Mistake three",
      "slide-4-body": "Explain the mistake here",
      "slide-5-headline": "Key takeaway",
      "slide-5-body": "Summarise the points",
      "slide-6-headline": "Follow us",
      "slide-6-cta": "Subscribe",
    },
    ar: {
      "slide-1-headline": "خمسة أخطاء",
      "slide-2-headline": "الخطأ الأول",
      "slide-2-body": "اشرح الخطأ هنا",
      "slide-3-headline": "الخطأ الثاني",
      "slide-3-body": "اشرح الخطأ هنا",
      "slide-4-headline": "الخطأ الثالث",
      "slide-4-body": "اشرح الخطأ هنا",
      "slide-5-headline": "الخلاصة",
      "slide-5-body": "لخص النقاط",
      "slide-6-headline": "تابعنا",
      "slide-6-cta": "اشترك",
    },
  },
  "carousel-offer": {
    en: {
      "slide-1-headline": "Spring offer",
      "slide-2-headline": "What you get",
      "slide-2-body": "Two lines of value",
      "slide-3-headline": "How it works",
      "slide-3-body": "Three short steps",
      "slide-4-headline": "Pricing",
      "slide-5-headline": "Guarantee",
      "slide-5-body": "Risk-free promise",
      "slide-6-headline": "Claim now",
      "slide-6-cta": "Get started",
    },
    ar: {
      "slide-1-headline": "عرض الربيع",
      "slide-2-headline": "ما ستحصل عليه",
      "slide-2-body": "سطران عن القيمة",
      "slide-3-headline": "كيف يعمل",
      "slide-3-body": "ثلاث خطوات قصيرة",
      "slide-4-headline": "السعر",
      "slide-5-headline": "الضمان",
      "slide-5-body": "وعد بلا مخاطرة",
      "slide-6-headline": "اطلب الآن",
      "slide-6-cta": "ابدأ الآن",
    },
  },
  "story-promo": {
    en: {
      "headline-1": "Story offer",
      "body-1": "Offer details here",
      "cta-1": "Swipe up",
    },
    ar: {
      "headline-1": "عرض القصة",
      "body-1": "تفاصيل العرض هنا",
      "cta-1": "اسحب للأعلى",
    },
  },
};

function localiseNodes(nodes: unknown, text: Record<string, string> | undefined): unknown {
  if (!Array.isArray(nodes) || !text) return nodes;
  return nodes.map((node) => {
    if (!node || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;
    const replacement = typeof record.id === "string" ? text[record.id] : undefined;
    return replacement === undefined ? record : { ...record, text: replacement };
  });
}

/**
 * Localise one of the eight platform starter templates for the requested UI
 * language. Tenant-owned designs are never altered, and a caller that omits
 * `?locale=` keeps the exact stored spec, so saved designs render unchanged.
 */
export function localizeStarterSpec(
  name: string,
  organizationId: string | null,
  spec: Record<string, unknown>,
  locale: StarterLocale | null,
): Record<string, unknown> {
  if (organizationId !== null || locale === null) return spec;
  const text = STARTER_TEXT[name]?.[locale];
  if (!text || !spec || typeof spec !== "object") return spec;
  const localised: LocalisedSpec = {
    ...spec,
    locale,
    direction: locale === "ar" ? "rtl" : "ltr",
  };
  if (Array.isArray(spec.pages)) {
    localised.pages = spec.pages.map((page) => {
      if (!page || typeof page !== "object") return page;
      const record = page as Record<string, unknown>;
      return { ...record, nodes: localiseNodes(record.nodes, text) };
    });
  }
  if (spec.nodes !== undefined) localised.nodes = localiseNodes(spec.nodes, text);
  return localised;
}
