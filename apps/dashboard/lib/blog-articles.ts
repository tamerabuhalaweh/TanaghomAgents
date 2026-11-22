import type { Metadata } from "next";

import type { CreativeLocale } from "@/lib/i18n/creative";
import { CANONICAL_SITE_URL, OG_IMAGE_URL, canonicalUrlFor, type FaqEntry } from "@/lib/seo";

export type BlogArticleSlug =
  | "ai-social-media-manager-small-business"
  | "ai-social-media-management-small-business";

export const BLOG_ARTICLE_PATHS = [
  "/blog/ai-social-media-manager-small-business",
  "/blog/ai-social-media-management-small-business",
] as const;

export interface BlogListItem {
  lead: string;
  text: string;
}

export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "ol"; items: BlogListItem[] }
  | { type: "ul"; items: BlogListItem[] };

export interface BlogSection {
  heading: string;
  blocks: BlogBlock[];
}

export interface BlogArticle {
  slug: BlogArticleSlug;
  locale: CreativeLocale;
  dir: "ltr" | "rtl";
  path: (typeof BLOG_ARTICLE_PATHS)[number];
  alternateSlug: BlogArticleSlug;
  alternateLabel: string;
  seoTitle: string;
  metaDescription: string;
  keywords: readonly string[];
  eyebrow: string;
  h1: string;
  publishedDate: string;
  intro: readonly string[];
  sections: readonly BlogSection[];
  faqHeading: string;
  faqs: readonly FaqEntry[];
  publisherNote: string;
  cta: {
    heading: string;
    body: string;
    primaryLabel: string;
    secondaryLabel: string;
  };
}

export const BLOG_ARTICLES: Record<BlogArticleSlug, BlogArticle> = {
  "ai-social-media-manager-small-business": {
    slug: "ai-social-media-manager-small-business",
    locale: "en",
    dir: "ltr",
    path: "/blog/ai-social-media-manager-small-business",
    alternateSlug: "ai-social-media-management-small-business",
    alternateLabel: "اقرأ هذا الدليل بالعربية",
    seoTitle: "AI Social Media Manager for Small Business | E3lani",
    metaDescription:
      "An AI social media manager plans, drafts, designs and schedules your posts in English and Arabic — and nothing publishes until you approve it. What it does, what it costs, and what still needs a human.",
    keywords: [
      "AI social media manager for small business",
      "bilingual AI marketing tool",
      "AI marketing with human approval",
      "AI marketing tool Arabic English",
    ],
    eyebrow: "Guide",
    h1: "AI Social Media Manager for a Small Business: What It Actually Does, What It Costs, and What Still Needs a Human",
    publishedDate: "2026-11-21",
    intro: [
      "An AI social media manager is software that plans, drafts, designs and schedules a small business's social media posts — with a person approving everything before it goes live. It replaces the hours a small team spends staring at a blank calendar, not the judgment of the person who owns the brand.",
      "Most small businesses are not choosing between AI and a great marketing hire. They are choosing between AI and nobody, with posting happening in stolen moments between actual work. Against that baseline, a good AI manager wins easily: consistent posting, decent copy, reclaimed hours, for less than the cost of one lunch a month.",
    ],
    sections: [
      {
        heading: "What an AI social media manager actually does",
        blocks: [
          { type: "p", text: "A real one does five jobs, in a loop:" },
          {
            type: "ol",
            items: [
              {
                lead: "Plan.",
                text: "It turns a short brief — what you sell, who you sell to, what you want to say this month — into a campaign plan: themes, post ideas, and a calendar.",
              },
              {
                lead: "Create.",
                text: "It writes the post copy and prepares the visuals for each channel, in the sizes each platform wants.",
              },
              {
                lead: "Approve.",
                text: "It shows you everything and waits. Nothing publishes until a human says yes.",
              },
              {
                lead: "Publish.",
                text: "Once approved, it posts on schedule to Instagram, Facebook, LinkedIn, TikTok and X.",
              },
              {
                lead: "Measure.",
                text: "It reports what worked, so next month's content is not a guess.",
              },
            ],
          },
          {
            type: "p",
            text: "That approval step is the one that matters most, and the one most tools skip or soften. An AI that publishes on its own will eventually publish something wrong — a wrong price, a wrong date, a tone-deaf post on a bad news day. The tool should do the drafting; the human should do the deciding. If a tool promises fully autonomous posting, be sceptical: unreviewed AI content is how brands end up apologising publicly.",
          },
        ],
      },
      {
        heading: "What it cannot do",
        blocks: [
          {
            type: "p",
            text: "It cannot decide what your business stands for. It cannot handle a sensitive customer complaint with tact. It cannot invent your strategy — it can only execute the one you give it. And it cannot approve its own work. A person still sets the direction, checks the facts (prices, hours, offers), and signs off before anything goes live.",
          },
          {
            type: "p",
            text: "The honest division of labour: the AI does the repetitive production; the human owns strategy, approval, and any conversation that needs a real person.",
          },
        ],
      },
      {
        heading: "What it costs",
        blocks: [
          { type: "p", text: "Three options, roughly:" },
          {
            type: "ul",
            items: [
              {
                lead: "A freelancer or agency:",
                text: "several hundred to several thousand dollars a month. Good judgment, slow, expensive for a small business.",
              },
              {
                lead: "A scheduling tool with AI features:",
                text: "$5 to $30 a month. It queues posts and suggests captions, but you still write the plan and do the production yourself.",
              },
              {
                lead: "A full AI marketing team:",
                text: "this is the newer category. E3lani, for example, runs the whole five-step loop for a flat price per workspace — Starter $15 a month, Growth $25, Scale $50 with the launch offer — with unlimited team seats, so the whole team can review and approve. There is also a free one-campaign sandbox with no card, so you can see the full loop before paying.",
              },
            ],
          },
          {
            type: "p",
            text: "The right comparison is not tool versus tool. It is tool versus the hours you currently lose. If the owner spends five hours a week on social media, even a $25 tool pays for itself in the first week.",
          },
        ],
      },
      {
        heading: "The bilingual problem most tools get wrong",
        blocks: [
          {
            type: "p",
            text: "Most AI marketing tools were built in English and had Arabic bolted on. The Arabic reads like a translation — technically correct, obviously not written by a native speaker. Your customers notice, even if they cannot say why.",
          },
          {
            type: "p",
            text: "If you sell to Arabic-speaking customers, the Arabic has to be written as Arabic, not translated from English. That means the tool plans and writes in both languages from the start, with a right-to-left workspace, not an English interface with an Arabic output taped on. E3lani was built bilingual from the ground up: English and Arabic campaigns, Arabic-first interface, and a brand kit that carries your tone in both languages.",
          },
        ],
      },
      {
        heading: "How to choose one",
        blocks: [
          { type: "p", text: "Ask these five questions before you pay for anything:" },
          {
            type: "ol",
            items: [
              {
                lead: "Does anything publish without my approval?",
                text: 'The answer must be no, with no exceptions and no "auto-pilot" mode.',
              },
              {
                lead: "Is it bilingual in the way I need?",
                text: "Test it with a real post in Arabic, not a demo. Read it as a customer would.",
              },
              {
                lead: "Does it do the whole loop, or just drafting?",
                text: "A tool that only writes captions leaves you with the same scheduling, publishing and measuring work.",
              },
              {
                lead: "Is the price flat or per seat?",
                text: "A per-seat price punishes you for letting your team help. Flat per-workspace pricing with unlimited seats does not.",
              },
              {
                lead: "Can I try the real thing before paying?",
                text: "A free sandbox with no card tells you more than any sales page.",
              },
            ],
          },
        ],
      },
    ],
    faqHeading: "FAQ",
    faqs: [
      {
        question: "Can a small business really run social media with AI?",
        answer:
          "Yes, with limits. AI can plan a content calendar, draft posts and captions, prepare images, schedule approved posts and report results. What it cannot do is decide what the business stands for or approve its own work. One person still sets direction and signs off before anything goes live.",
      },
      {
        question: "How much does an AI social media manager cost?",
        answer:
          "Scheduling tools with AI features run roughly $5 to $30 a month. A full AI marketing team like E3lani starts at $15 a month with the launch offer. A freelancer or agency costs several hundred to several thousand dollars a month.",
      },
      {
        question: "Does AI write good Arabic?",
        answer:
          "Most tools do not — they translate from English, and it shows. Look for a tool that writes Arabic natively, with a right-to-left workspace, and test it with a real post before you commit.",
      },
      {
        question: "Will AI publish something embarrassing without asking me?",
        answer:
          "Only if you let it. Choose a tool where human approval is mandatory, not optional. In E3lani, nothing ever publishes until a human approves it — that is the rule, not a setting.",
      },
      {
        question: "What channels does it publish to?",
        answer:
          "E3lani publishes to Instagram, Facebook, LinkedIn, TikTok and X. WhatsApp and Meta ad buying are not available yet.",
      },
    ],
    publisherNote:
      "Published by E3lani — the bilingual AI marketing team for small businesses. Plan, Create, Approve, Publish, Measure. Nothing publishes until you approve it.",
    cta: {
      heading: "Try the five-step loop with your own brand.",
      body: "Start with a free one-campaign sandbox — no card required, and nothing ever publishes without human approval.",
      primaryLabel: "Start your workspace",
      secondaryLabel: "Compare plans",
    },
  },
  "ai-social-media-management-small-business": {
    slug: "ai-social-media-management-small-business",
    locale: "ar",
    dir: "rtl",
    path: "/blog/ai-social-media-management-small-business",
    alternateSlug: "ai-social-media-manager-small-business",
    alternateLabel: "Read this guide in English",
    seoTitle: "إدارة السوشيال ميديا بالذكاء الاصطناعي للشركات الصغيرة | إعلاني",
    metaDescription:
      "أداة ذكاء اصطناعي تخطط لمنشوراتك وتكتبها وتصممها وتنشرها بالعربية والإنجليزية — ولا يُنشر شيء قبل موافقتك. ما الذي تفعله، وكم تكلف، وما الذي يبقى بيدك.",
    keywords: [
      "إدارة السوشيال ميديا بالذكاء الاصطناعي",
      "التسويق بالذكاء الاصطناعي للشركات الصغيرة",
      "أداة تسويق بالذكاء الاصطناعي بالعربية",
      "فريق تسويق بالذكاء الاصطناعي",
    ],
    eyebrow: "دليل",
    h1: "إدارة السوشيال ميديا بالذكاء الاصطناعي للشركات الصغيرة: ما الذي تفعله الأداة، وما الذي يبقى بيدك؟",
    publishedDate: "2026-11-21",
    intro: [
      "أداة إدارة السوشيال ميديا بالذكاء الاصطناعي هي برنامج يخطط لمنشورات شركتك الصغيرة ويكتبها ويصممها وينشرها في موعدها — ولا يُنشر أي شيء قبل أن يوافق عليه إنسان. هي بديل عن الساعات التي يقضيها فريق صغير أمام تقويم فارغ، وليست بديلًا عن حكم صاحب العلامة التجارية.",
      "معظم الشركات الصغيرة لا تختار بين الذكاء الاصطناعي وموظف تسويق ممتاز. هي تختار بين الذكاء الاصطناعي وبين لا أحد، والنشر يتم في لحظات مسروقة بين أعمال حقيقية. أمام هذا الواقع، أداة جيدة تكسب بسهولة: نشر منتظم، ونصوص جيدة، وساعات مسترجعة، بتكلفة أقل من وجبة غداء واحدة في الشهر.",
    ],
    sections: [
      {
        heading: "ما الذي تفعله الأداة فعلًا؟",
        blocks: [
          { type: "p", text: "الأداة الحقيقية تقوم بخمسة أعمال، في دورة واحدة:" },
          {
            type: "ol",
            items: [
              {
                lead: "التخطيط.",
                text: "تحوّل وصفًا قصيرًا — ماذا تبيع، ولمن تبيع، وماذا تريد أن تقول هذا الشهر — إلى خطة حملة: المواضيع، وأفكار المنشورات، والتقويم.",
              },
              {
                lead: "الإنشاء.",
                text: "تكتب نص المنشور وتجهز الصور لكل منصة، بالمقاسات التي تريدها كل منصة.",
              },
              {
                lead: "الموافقة.",
                text: "تعرض عليك كل شيء وتنتظر. لا يُنشر شيء قبل أن يقول إنسان: نعم.",
              },
              {
                lead: "النشر.",
                text: "بعد الموافقة، تنشر في موعدها على إنستغرام وفيسبوك ولينكدإن وتيك توك وإكس.",
              },
              {
                lead: "القياس.",
                text: "تخبرك بما نجح، حتى لا يكون محتوى الشهر القادم تخمينًا.",
              },
            ],
          },
          {
            type: "p",
            text: "خطوة الموافقة هي الأهم، وهي التي تتجاوزها معظم الأدوات أو تخففها. ذكاء اصطناعي ينشر وحده سينشر يومًا ما شيئًا خاطئًا — سعرًا خاطئًا، أو تاريخًا خاطئًا، أو منشورًا غير لائق في يوم سيئ. الأداة تكتب المسودات؛ والإنسان يقرر. إذا وعدتك أداة بالنشر الذاتي الكامل، فكن حذرًا: المحتوى غير المراجَع هو الطريق الأسرع إلى اعتذار علني.",
          },
        ],
      },
      {
        heading: "ما الذي لا تستطيع فعله؟",
        blocks: [
          {
            type: "p",
            text: "لا تستطيع أن تقرر ما الذي تمثله شركتك. ولا أن تتعامل بلباقة مع شكوى عميل حساسة. ولا أن تخترع استراتيجيتك — هي تنفذ فقط الاستراتيجية التي تعطيها إياها. ولا تستطيع أن توافق على عملها بنفسها. يبقى الإنسان هو من يحدد الاتجاه، ويتحقق من الحقائق (الأسعار، وساعات العمل، والعروض)، ويوقع قبل نشر أي شيء.",
          },
          {
            type: "p",
            text: "التقسيم الصادق للعمل: الذكاء الاصطناعي يقوم بالإنتاج المتكرر؛ والإنسان يملك الاستراتيجية والموافقة وأي محادثة تحتاج شخصًا حقيقيًا.",
          },
        ],
      },
      {
        heading: "كم تكلف؟",
        blocks: [
          { type: "p", text: "ثلاثة خيارات تقريبًا:" },
          {
            type: "ul",
            items: [
              {
                lead: "مستقل أو وكالة:",
                text: "مئات إلى آلاف الدولارات شهريًا. حكم جيد، وبطء، وتكلفة عالية على شركة صغيرة.",
              },
              {
                lead: "أداة جدولة فيها مزايا ذكاء اصطناعي:",
                text: "من 5 إلى 30 دولارًا شهريًا. ترتب المنشورات وتقترح النصوص، لكنك تبقى أنت من يكتب الخطة ويقوم بالإنتاج.",
              },
              {
                lead: "فريق تسويق كامل بالذكاء الاصطناعي:",
                text: "هذه الفئة الأحدث. إعلاني مثلًا يدير الدورة الكاملة من خمس خطوات بسعر ثابت لكل مساحة عمل — 15 دولارًا شهريًا للباقة الأولى، و25 للثانية، و50 للثالثة مع عرض الإطلاق — مع عدد غير محدود من أعضاء الفريق، فيراجع الجميع ويوافق. وهناك تجربة مجانية لحملة واحدة بدون بطاقة، لترى الدورة الكاملة قبل أن تدفع.",
              },
            ],
          },
          {
            type: "p",
            text: "المقارنة الصحيحة ليست أداة مقابل أداة. بل أداة مقابل الساعات التي تخسرها الآن. إذا كان صاحب الشركة يقضي خمس ساعات أسبوعيًا على السوشيال ميديا، فأداة بـ25 دولارًا تدفع ثمنها في الأسبوع الأول.",
          },
        ],
      },
      {
        heading: "مشكلة اللغة العربية التي تخطئ فيها معظم الأدوات",
        blocks: [
          {
            type: "p",
            text: "معظم أدوات التسويق بالذكاء الاصطناعي بُنيت بالإنجليزية ثم أُضيفت إليها العربية. فتقرأ العربية كأنها ترجمة — صحيحة تقنيًا، وواضح أنها ليست من كتابة ناطق بها. عملاؤك يلاحظون ذلك، حتى لو لم يستطيعوا شرح السبب.",
          },
          {
            type: "p",
            text: "إذا كنت تبيع لعملاء يتحدثون العربية، فلا بد أن تُكتب العربية عربيةً منذ البداية، لا أن تُترجم من الإنجليزية. هذا يعني أن الأداة تخطط وتكتب باللغتين من الأساس، بواجهة عربية من اليمين إلى اليسار، لا واجهة إنجليزية أُلصق عليها مخرج عربي. إعلاني بُني ثنائي اللغة منذ البداية: حملات بالإنجليزية والعربية، وواجهة عربية كاملة، ودليل علامة يحمل نبرتك في اللغتين.",
          },
        ],
      },
      {
        heading: "كيف تختار أداة؟",
        blocks: [
          { type: "p", text: "اسأل هذه الأسئلة الخمسة قبل أن تدفع أي شيء:" },
          {
            type: "ol",
            items: [
              {
                lead: "هل يُنشر أي شيء دون موافقتي؟",
                text: 'يجب أن تكون الإجابة: لا، دون استثناءات ودون وضع "طيار آلي".',
              },
              {
                lead: "هل هي ثنائية اللغة كما أحتاج؟",
                text: "جرّبها بمنشور عربي حقيقي، لا بعرض توضيحي. اقرأه كما يقرأه عميلك.",
              },
              {
                lead: "هل تقوم بالدورة كاملة أم بالكتابة فقط؟",
                text: "أداة تكتب النصوص فقط تترك لك الجدولة والنشر والقياس.",
              },
              {
                lead: "هل السعر ثابت أم لكل مقعد؟",
                text: "السعر لكل مقعد يعاقبك لأنك تشرك فريقك. السعر الثابت لكل مساحة عمل مع أعضاء غير محدودين لا يفعل ذلك.",
              },
              {
                lead: "هل أستطيع تجربة الشيء الحقيقي قبل الدفع؟",
                text: "تجربة مجانية بدون بطاقة تخبرك أكثر من أي صفحة مبيعات.",
              },
            ],
          },
        ],
      },
    ],
    faqHeading: "الأسئلة الشائعة",
    faqs: [
      {
        question: "هل تستطيع شركة صغيرة فعلًا إدارة السوشيال ميديا بالذكاء الاصطناعي؟",
        answer:
          "نعم، ضمن حدود. يستطيع الذكاء الاصطناعي تخطيط تقويم المحتوى، وكتابة المنشورات، وتجهيز الصور، وجدولة المنشورات المعتمدة، وتقديم التقارير. وما لا يستطيع فعله هو أن يقرر ما الذي تمثله الشركة أو أن يوافق على عمله بنفسه. يبقى شخص واحد على الأقل يحدد الاتجاه ويوافق قبل نشر أي شيء.",
      },
      {
        question: "كم تكلف أداة إدارة سوشيال ميديا بالذكاء الاصطناعي؟",
        answer:
          "أدوات الجدولة ذات مزايا الذكاء الاصطناعي تكلف تقريبًا من 5 إلى 30 دولارًا شهريًا. وفريق تسويق كامل بالذكاء الاصطناعي مثل إعلاني يبدأ من 15 دولارًا شهريًا مع عرض الإطلاق. أما المستقل أو الوكالة فيكلف مئات إلى آلاف الدولارات شهريًا.",
      },
      {
        question: "هل يكتب الذكاء الاصطناعي عربية جيدة؟",
        answer:
          "معظم الأدوات لا تفعل — هي تترجم من الإنجليزية، وهذا يظهر. ابحث عن أداة تكتب العربية أصالةً، بواجهة من اليمين إلى اليسار، وجرّبها بمنشور حقيقي قبل أن تلتزم.",
      },
      {
        question: "هل ينشر الذكاء الاصطناعي شيئًا محرجًا دون أن يسألني؟",
        answer:
          "فقط إذا سمحت له. اختر أداة تكون فيها الموافقة البشرية إلزامية، لا اختيارية. في إعلاني، لا يُنشر شيء أبدًا قبل أن يوافق عليه إنسان — هذه قاعدة، وليست إعدادًا.",
      },
      {
        question: "على أي منصات ينشر؟",
        answer:
          "ينشر إعلاني على إنستغرام وفيسبوك ولينكدإن وتيك توك وإكس. واتساب وشراء إعلانات ميتا غير متاحين بعد.",
      },
    ],
    publisherNote:
      "نشرته إعلاني — فريق التسويق بالذكاء الاصطناعي ثنائي اللغة للشركات الصغيرة. خطط، أنشئ، وافق، انشر، قِس. لا يُنشر شيء قبل موافقتك.",
    cta: {
      heading: "جرّب الدورة الكاملة من خمس خطوات مع علامتك.",
      body: "ابدأ بتجربة مجانية لحملة واحدة بدون بطاقة — ولا يُنشر أي شيء أبدًا قبل موافقتك البشرية.",
      primaryLabel: "ابدأ بمساحة عملك",
      secondaryLabel: "قارن الباقات",
    },
  },
};

export function buildBlogArticleMetadata(slug: BlogArticleSlug): Metadata {
  const article = BLOG_ARTICLES[slug];
  const url = canonicalUrlFor(article.path);
  const enUrl = canonicalUrlFor(BLOG_ARTICLES["ai-social-media-manager-small-business"].path);
  const arUrl = canonicalUrlFor(BLOG_ARTICLES["ai-social-media-management-small-business"].path);
  const ar = article.locale === "ar";

  return {
    title: { absolute: article.seoTitle },
    description: article.metaDescription,
    keywords: [...article.keywords],
    alternates: {
      canonical: url,
      languages: {
        en: enUrl,
        ar: arUrl,
        "x-default": enUrl,
      },
    },
    openGraph: {
      type: "article",
      publishedTime: `${article.publishedDate}T00:00:00.000Z`,
      siteName: ar ? "إعلاني" : "E3lani",
      locale: ar ? "ar_AR" : "en_US",
      alternateLocale: ar ? ["en_US"] : ["ar_AR"],
      url,
      title: article.seoTitle,
      description: article.metaDescription,
      images: [
        {
          url: OG_IMAGE_URL,
          width: 1200,
          height: 630,
          alt: article.seoTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: article.seoTitle,
      description: article.metaDescription,
      images: [OG_IMAGE_URL],
    },
  };
}

export function blogArticleJsonLd(slug: BlogArticleSlug) {
  const article = BLOG_ARTICLES[slug];
  const url = canonicalUrlFor(article.path);
  const publisher = {
    "@type": "Organization",
    "@id": `${CANONICAL_SITE_URL}/#organization`,
    name: "E3lani",
    alternateName: "إعلاني",
    url: `${CANONICAL_SITE_URL}/`,
    logo: {
      "@type": "ImageObject",
      url: OG_IMAGE_URL,
    },
  };

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${url}#article`,
        headline: article.h1,
        description: article.metaDescription,
        inLanguage: article.locale,
        datePublished: article.publishedDate,
        dateModified: article.publishedDate,
        url,
        mainEntityOfPage: url,
        image: OG_IMAGE_URL,
        keywords: article.keywords.join(", "),
        author: {
          "@type": "Organization",
          name: "E3lani",
          alternateName: "إعلاني",
          url: `${CANONICAL_SITE_URL}/`,
        },
        publisher,
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: article.faqs.map((item) => ({
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
