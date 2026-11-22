import type { Metadata } from "next";

import type { CreativeLocale } from "@/lib/i18n/creative";

export const CANONICAL_SITE_URL = "https://www.e3lani.online";
export const APP_SITE_URL = "https://app.e3lani.online";
export const SUPPORT_EMAIL = "Tamer@itis-uk.org";
export const SUPPORT_EMAIL_HREF = `mailto:${SUPPORT_EMAIL}`;
export const OG_IMAGE_PATH = "/opengraph-image";
export const OG_IMAGE_URL = `${CANONICAL_SITE_URL}${OG_IMAGE_PATH}`;

export const DISALLOWED_CRAWL_PATHS = [
  "/api/",
  "/workspace/",
  "/campaigns/",
  "/content/",
  "/settings/",
  "/super-admin/",
  "/onboarding/",
  "/login/",
  "/signup/",
  "/accept-invite/",
  "/verify-email/",
  "/forgot-password/",
  "/reset-password/",
] as const;

export type PublicSeoPageKey = "home" | "pricing" | "privacy" | "terms";

interface LocalizedMeta {
  title: string;
  description: string;
}

export const PUBLIC_SEO_COPY: Record<
  PublicSeoPageKey,
  { path: string; en: LocalizedMeta; ar: LocalizedMeta }
> = {
  home: {
    path: "/",
    en: {
      title: "E3lani — Bilingual AI Marketing Team With Human Approval",
      description:
        "E3lani is the AI marketing team for small businesses. Plan, create, and approve English and Arabic campaigns in one workspace from $15/month.",
    },
    ar: {
      title: "إعلاني — فريق التسويق بالذكاء الاصطناعي باعتماد بشري",
      description:
        "إعلاني هو فريق التسويق بالذكاء الاصطناعي للشركات الصغيرة. خطّط وأنشئ واعتمد حملاتك بالعربية والإنجليزية في مساحة عمل واحدة بدءًا من 15 دولارًا شهريًا.",
    },
  },
  pricing: {
    path: "/pricing",
    en: {
      title: "E3lani Pricing — Flat Plans From $15/Mo for Small Teams",
      description:
        "Compare E3lani Starter ($15/mo), Growth ($25/mo), and Scale ($50/mo) LAUNCH100 plans. Unlimited seats, 15–200 AI campaigns, and human approval.",
    },
    ar: {
      title: "أسعار إعلاني — باقات ثابتة تبدأ من 15 دولارًا شهريًا",
      description:
        "قارن باقات إعلاني LAUNCH100: البداية (15 دولارًا)، النمو (25 دولارًا)، التوسع (50 دولارًا شهريًا). مقاعد غير محدودة واعتماد بشري لكل منشور.",
    },
  },
  privacy: {
    path: "/privacy",
    en: {
      title: "Privacy Policy — Your Data & Social Tokens | E3lani",
      description:
        "Learn what data E3lani collects, how we protect your workspace, and how to disconnect social channels and purge OAuth tokens at any time.",
    },
    ar: {
      title: "سياسة الخصوصية — بياناتك وقنواتك تحت سيطرتك | إعلاني",
      description:
        "تعرّف على ما يجمعه إعلاني وكيف يحمي مساحة عملك وكيف يمكنك فصل قنوات التواصل الاجتماعي وحذف رموز OAuth في أي وقت.",
    },
  },
  terms: {
    path: "/terms",
    en: {
      title: "Terms of Service — Human Approval & Usage | E3lani",
      description:
        "Read E3lani's Terms of Service covering workspace responsibilities, mandatory human approval before publishing, connected channels, and billing.",
    },
    ar: {
      title: "شروط الخدمة — الاعتماد البشري واستخدام مساحة إعلاني",
      description:
        "اطلع على شروط خدمة إعلاني التي تغطي مسؤوليات مساحة العمل والاعتماد البشري الإلزامي قبل النشر والقنوات المرتبطة والاشتراك.",
    },
  },
};

export function canonicalUrlFor(path: string): string {
  if (path === "/" || path === "") return `${CANONICAL_SITE_URL}/`;
  return `${CANONICAL_SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildPublicPageMetadata(
  page: PublicSeoPageKey,
  locale: CreativeLocale,
): Metadata {
  const entry = PUBLIC_SEO_COPY[page];
  const copy = locale === "ar" ? entry.ar : entry.en;
  const url = canonicalUrlFor(entry.path);
  const ar = locale === "ar";
  const imageAlt = ar
    ? "إعلاني — فريق التسويق بالذكاء الاصطناعي باعتماد بشري"
    : "E3lani — Bilingual AI marketing team with human approval";

  return {
    title: { absolute: copy.title },
    description: copy.description,
    alternates: {
      canonical: url,
      languages: {
        en: url,
        ar: url,
        "x-default": url,
      },
    },
    openGraph: {
      type: "website",
      siteName: ar ? "إعلاني" : "E3lani",
      locale: ar ? "ar_AR" : "en_US",
      alternateLocale: ar ? ["en_US"] : ["ar_AR"],
      url,
      title: copy.title,
      description: copy.description,
      images: [
        {
          url: OG_IMAGE_URL,
          width: 1200,
          height: 630,
          alt: imageAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
      images: [OG_IMAGE_URL],
    },
  };
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export function landingFaqEntries(locale: CreativeLocale): FaqEntry[] {
  if (locale === "ar") {
    return [
      {
        question: "هل إعلاني بالدعوة فقط؟",
        answer:
          "نبدأ بدفعة بالدعوة فقط من 20 مساحة عمل نشطة، ثم نتوسع إلى 100 مساحة إطلاق عبر قائمة الأولوية. سعر LAUNCH100 مخصص لأول 100 مساحة عمل.",
      },
      {
        question: "هل السعر لكل مساحة عمل أم لكل مقعد؟",
        answer:
          "سعر ثابت واحد لكل مساحة عمل، لا لكل مقعد. ادعُ فريقك دون دفع مقابل مقاعد إضافية؛ تختلف الخطط بحجم حملات الذكاء الاصطناعي والسعة.",
      },
      {
        question: "من يملك الحملات والبيانات التي ننشئها؟",
        answer:
          "أنت. يبقى موجزك ومحتواك واعتماداتك ومعرفتك بالعلامة في مساحة عملك. فصل قناة تواصل يلغي رمز OAuth ويحذفه؛ ويبقى محتواك وسجل اعتمادك ملكاً لك.",
      },
      {
        question: "ما الذي يفعله إعلاني بالضبط؟",
        answer:
          "يدير تسويقك كدورة واحدة متصلة: يخطط الحملات، ويكتب النصوص، ويجهّز التصاميم بالإنجليزية والعربية، ثم ينتظر اعتماد إنسان لكل منشور قبل النشر.",
      },
      {
        question: "هل العربية أصلية أم مترجمة؟",
        answer:
          "مساحة العمل مبنية للعربية من اليمين إلى اليسار، بخطوط عربية أصيلة. ويُنشأ المحتوى العربي والإنجليزي معاً، لا يُترجم في النهاية.",
      },
      {
        question: "هل أحتاج بطاقة للبدء؟",
        answer:
          "ابدأ بتجربة مجانية لحملة متكاملة: حزمة حملة كاملة وثلاث عمليات توليد بالذكاء الاصطناعي، دون قنوات اجتماعية حقيقية ودون بطاقة.",
      },
      {
        question: "كيف أتواصل مع الدعم؟",
        answer:
          "راسلنا على Tamer@itis-uk.org لمساعدة التهيئة أو أسئلة الحساب أو دعم مساحة العمل.",
      },
    ];
  }
  return [
    {
      question: "Is E3lani invite-only?",
      answer:
        "We start with an invite-only cohort of 20 active workspaces, then expand to 100 launch workspaces through the priority waitlist. LAUNCH100 pricing is reserved for those first 100 workspaces.",
    },
    {
      question: "Is pricing per workspace or per seat?",
      answer:
        "One flat price per workspace, not per seat. Invite your team without extra seat fees; plans differ by AI campaign volume and capacity.",
    },
    {
      question: "Who owns the campaigns and data we create?",
      answer:
        "You do. Your briefs, content, approvals and brand knowledge stay in your workspace. Disconnecting a social channel revokes and purges its OAuth token; your content and approval history remain yours.",
    },
    {
      question: "What exactly does E3lani do?",
      answer:
        "It runs your marketing as one connected loop: it plans campaigns, writes copy, prepares visuals in English and Arabic, and waits for a person to approve every post before publishing.",
    },
    {
      question: "Is the Arabic native or translated?",
      answer:
        "The workspace is RTL-first, with Arabic typography including Cairo, Tajawal, IBM Plex Sans Arabic and Almarai. Arabic and English are created together, not translated at the end.",
    },
    {
      question: "Do I need a card to start?",
      answer:
        "Start with the Free 1-Campaign Sandbox: one complete AI Campaign Work Pack and three AI runs, with no live social channels and no card required.",
    },
    {
      question: "How do I contact support?",
      answer:
        "Email us at Tamer@itis-uk.org for onboarding help, account questions, or workspace support.",
    },
  ];
}

export function pricingFaqEntries(locale: CreativeLocale): FaqEntry[] {
  if (locale === "ar") {
    return [
      {
        question: "هل يمكنني تجربة المساحة قبل الدفع؟",
        answer:
          "أنشئ مساحة عملك وأكمل الإعداد. تظهر إعدادات الفوترة بوضوح، ولا تُنشر أي حملة دون اعتمادك.",
      },
      {
        question: "ماذا يحدث لمحتواي إذا غيّرت الخطة؟",
        answer:
          "يبقى محتواك ومسوداتك وسجل اعتمادك في مساحة عملك. تتغير حدود الخطة والمقاعد فقط.",
      },
      {
        question: "هل تنشرون تلقائياً؟",
        answer:
          "لا. كل مخرج يبقى مسودة حتى يعتمده إنسان. وحتى النشر يمر عبر قنواتك وإعداداتك.",
      },
      {
        question: "هل السعر لكل مساحة عمل أم لكل مقعد؟",
        answer:
          "سعر ثابت واحد لكل مساحة عمل، لا لكل مقعد. ادعُ فريقك دون دفع مقابل مقاعد إضافية؛ تختلف الخطط بحجم حملات الذكاء الاصطناعي والسعة.",
      },
    ];
  }
  return [
    {
      question: "Can I try the workspace before paying?",
      answer:
        "Create your workspace and complete setup. Billing readiness is shown clearly, and nothing publishes without your approval.",
    },
    {
      question: "What happens to my work if I change plans?",
      answer:
        "Your content, drafts and approval history stay in your workspace. Only plan limits and seats change.",
    },
    {
      question: "Do you publish automatically?",
      answer:
        "No. Every output stays a draft until a person approves it. Publishing still follows your channels and settings.",
    },
    {
      question: "Is pricing per workspace or per seat?",
      answer:
        "One flat price per workspace, not per seat. Invite your team without paying for extra seats; plans differ by AI campaign volume and capacity.",
    },
  ];
}

export function landingJsonLd(locale: CreativeLocale) {
  const ar = locale === "ar";
  const faqs = landingFaqEntries(locale);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${CANONICAL_SITE_URL}/#organization`,
        name: "E3lani",
        alternateName: "إعلاني",
        url: `${CANONICAL_SITE_URL}/`,
        email: SUPPORT_EMAIL,
        logo: OG_IMAGE_URL,
        description: ar ? PUBLIC_SEO_COPY.home.ar.description : PUBLIC_SEO_COPY.home.en.description,
      },
      {
        "@type": "WebSite",
        "@id": `${CANONICAL_SITE_URL}/#website`,
        name: "E3lani",
        alternateName: "إعلاني",
        url: `${CANONICAL_SITE_URL}/`,
        inLanguage: ["en", "ar"],
        publisher: { "@id": `${CANONICAL_SITE_URL}/#organization` },
      },
      {
        "@type": "FAQPage",
        "@id": `${CANONICAL_SITE_URL}/#faq`,
        mainEntity: faqs.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      },
    ],
  };
}

export function pricingJsonLd(locale: CreativeLocale) {
  const faqs = pricingFaqEntries(locale);
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
