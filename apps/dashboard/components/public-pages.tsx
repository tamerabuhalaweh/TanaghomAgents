import Link from "next/link";
import { ArrowRight, Check, CircleCheck, ShieldCheck, Sparkles } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { LocaleToggle } from "@/components/creative/locale-toggle";
import { WaitlistForm } from "@/components/waitlist-form";
import type { CreativeLocale } from "@/lib/i18n/creative";
import { formatNumber } from "@/lib/i18n/format";

type Locale = CreativeLocale;

function PublicHeader({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <header className="public-header">
      <Link className="public-brand" href="/" aria-label={ar ? "إعلاني" : "E3lani"}>
        <BrandMark />
        <span>{ar ? "إعلاني" : "E3lani"}</span>
      </Link>
      <nav className="public-nav" aria-label={ar ? "التنقل العام" : "Public navigation"}>
        <Link href="/pricing">{ar ? "الأسعار" : "Pricing"}</Link>
        <Link href="/privacy">{ar ? "الخصوصية" : "Privacy"}</Link>
        <Link href="/terms">{ar ? "الشروط" : "Terms"}</Link>
      </nav>
      <div className="public-actions">
        <div className="public-locale"><LocaleToggle locale={locale} /></div>
        <Link className="public-signin" href="/login">{ar ? "تسجيل الدخول" : "Sign in"}</Link>
        <Link className="public-button public-button-small" href="/signup">{ar ? "ابدأ الآن" : "Get started"}</Link>
      </div>
    </header>
  );
}

function PublicFooter({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <footer className="public-footer">
      <div>
        <Link className="public-brand" href="/"><BrandMark /><span>{ar ? "إعلاني" : "E3lani"}</span></Link>
        <p>{ar ? "إعلاني يمنح فرق التسويق مساحة عمل ثنائية اللغة تعمل بالذكاء الاصطناعي، مع اعتماد بشري واضح لكل ما يصل إلى العملاء." : "E3lani gives marketing teams a bilingual AI workspace with clear human approval for everything that reaches customers."}</p>
      </div>
      <nav aria-label={ar ? "روابط التذييل" : "Footer links"}>
        <Link href="/pricing">{ar ? "الأسعار" : "Pricing"}</Link>
        <Link href="/privacy">{ar ? "الخصوصية" : "Privacy"}</Link>
        <Link href="/terms">{ar ? "الشروط" : "Terms"}</Link>
        <Link href="/login">{ar ? "تسجيل الدخول" : "Sign in"}</Link>
      </nav>
      <p className="public-copyright">{ar ? `© ${new Date().getFullYear()} إعلاني` : `© ${new Date().getFullYear()} E3lani`}</p>
    </footer>
  );
}

const tiers = [
  {
    id: "starter",
    list: 49, promo: 15,
    en: { name: "Starter", lede: "For one brand finding its rhythm.", features: ["15 AI campaigns / month", "Unlimited team members in 1 workspace", "Full 5-step agent loop", "Mandatory human approval", "EN + AR RTL workspace", "Visual Brand Kit & Knowledge Base"] },
    ar: { name: "باقة البداية", lede: "لعلامة واحدة تبحث عن إيقاعها.", features: ["15 حملة ذكاء اصطناعي شهرياً", "أعضاء فريق غير محدودين في مساحة عمل واحدة", "دورة الوكلاء الكاملة من 5 خطوات", "اعتماد بشري إلزامي", "مساحة عمل بالعربية والإنجليزية، باتجاه الكتابة الصحيح لكل لغة", "هوية بصرية مرئية وقاعدة معرفة"] },
  },
  {
    id: "growth",
    list: 129, promo: 25,
    en: { name: "Growth", lede: "For teams running always-on campaigns.", features: ["Everything in Starter", "50 AI campaigns / month", "Multi-channel publishing sync", "Priority generation"] },
    ar: { name: "باقة النمو", lede: "للفرق التي تدير حملات مستمرة.", features: ["كل ما في باقة البداية", "50 حملة ذكاء اصطناعي شهرياً", "مزامنة النشر متعدد القنوات", "توليد ذو أولوية"] },
    featured: true,
  },
  {
    id: "scale",
    list: 249, promo: 50,
    en: { name: "Scale", lede: "For agencies coordinating multiple brands.", features: ["Everything in Growth", "200 AI campaigns / month", "Full workspace capacity", "Dedicated onboarding support"] },
    ar: { name: "باقة التوسع", lede: "للوكالات التي تنسّق علامات متعددة.", features: ["كل ما في باقة النمو", "200 حملة ذكاء اصطناعي شهرياً", "سعة مساحة عمل كاملة", "دعم تهيئة مخصص"] },
  },
] as const;

function PricingCards({ locale, detailed = false, launch100Active = true }: { locale: Locale; detailed?: boolean; launch100Active?: boolean }) {
  const ar = locale === "ar";
  return (
    <div className={`public-pricing-grid ${detailed ? "public-pricing-detailed" : ""}`}>
      {tiers.map((tier) => {
        const text = ar ? tier.ar : tier.en;
        return (
          <article key={tier.id} className={`public-price-card ${"featured" in tier && tier.featured ? "public-price-featured" : ""}`}>
            {launch100Active ? <span className="public-price-tag">{ar ? <><bdi dir="ltr">LAUNCH100</bdi> — عرض الإطلاق لأول 100 مساحة عمل</> : <><bdi dir="ltr">LAUNCH100</bdi> — First 100 Workspaces</>}</span> : null}
            {"featured" in tier && tier.featured ? <span className="public-price-popular">{ar ? "الأكثر شيوعًا" : "Most popular"}</span> : null}
            <h3>{text.name}</h3>
            <p className="public-price-lede">{text.lede}</p>
            <div className="public-price-value">
              {launch100Active ? <s className="public-price-was" dir={ar ? "rtl" : "ltr"}>{ar ? `${formatNumber(tier.list, "ar")} دولارًا` : `$${tier.list}`}</s> : null}
              <strong dir={ar ? "rtl" : "ltr"}>{ar ? `${formatNumber(launch100Active ? tier.promo : tier.list, "ar")} دولارًا` : `$${launch100Active ? tier.promo : tier.list}`}</strong><span>{ar ? "شهرياً" : "per month"}</span>
            </div>
            <ul>{text.features.map((feature) => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}</ul>
            <Link className={tier.id === "growth" ? "public-button" : "public-button public-button-outline"} href="/signup">
              {ar ? "ابدأ بمساحة عملك" : "Start your workspace"}<ArrowRight size={16} />
            </Link>
          </article>
        );
      })}
    </div>
  );
}

export function PublicLandingPage({ locale, launch100Active = true, cohortFull = false }: { locale: Locale; launch100Active?: boolean; cohortFull?: boolean }) {
  const ar = locale === "ar";
  return (
    <main className="public-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <PublicHeader locale={locale} />
      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="public-eyebrow"><Sparkles size={15} aria-hidden="true" />{ar ? "ذكاء اصطناعي تحت إشرافك" : "AI with your hand on the wheel"}</p>
          <h1>{ar ? "حملات أسرع. وكل قرار يبقى بيدك." : "Campaigns move faster. Every decision stays in your hands."}</h1>
          <p className="public-hero-lede">{ar ? "إعلاني هو فريقك التسويقي بالذكاء الاصطناعي. يخطط لحملاتك، ويكتب محتواك، ويجهّز كل منشور — ثم ينتظر موافقتك. لا يُنشر شيء من دونك. بالإنجليزية والعربية، في مساحة عمل واحدة، وبسعر ثابت واحد." : "E3lani is your AI marketing team. It plans your campaigns, writes your content, and prepares every post — then waits for your approval. Nothing goes live without you. In English and Arabic, in one workspace, for one flat price."}</p>
          <div className="public-hero-actions">
            <Link className="public-button" href="/signup">{ar ? "أنشئ مساحة عملك" : "Create your workspace"}<ArrowRight size={17} /></Link>
            <Link className="public-button public-button-outline" href="/login">{ar ? "تسجيل الدخول" : "Sign in"}</Link>
          </div>
          <p className="public-trust"><ShieldCheck size={18} aria-hidden="true" />{ar ? <>ابدأ بحملة ذكاء اصطناعي مجانية (دون بطاقة) · موافقة بشرية في كل باقة · الترقية تبدأ من <bdi>{formatNumber(15, "ar")} دولارًا</bdi> شهريًا برمز <bdi dir="ltr">LAUNCH100</bdi></> : <>Start with 1 free AI campaign (no card required) · Human approval on every plan · Upgrade from <bdi dir="ltr">$15/mo</bdi> with <bdi dir="ltr">LAUNCH100</bdi></>}</p>
        </div>

        <div className="public-preview" aria-label={ar ? "معاينة حملة ثنائية اللغة مع اعتماد بشري" : "Bilingual campaign preview with human approval"}>
          <div className="public-preview-top">
            <span className="public-preview-dot" /><span className="public-preview-dot" /><span className="public-preview-dot" />
            <strong>{ar ? "حملة إطلاق — الأسبوع الثاني" : "Launch campaign — week two"}</strong>
            <span className="public-preview-live">{ar ? "قيد المراجعة" : "In review"}</span>
          </div>
          <div className="public-preview-body">
            <article className="public-post-card" lang="en" dir="ltr">
              <span className="public-post-label">EN</span>
              <h3>A quieter morning, a better cup.</h3>
              <p>Our new single-origin roast is here — bright, balanced, and ready for your first sip.</p>
              <div className="public-post-visual public-post-visual-en" />
              <small>Instagram · Draft</small>
            </article>
            <article className="public-post-card" lang="ar" dir="rtl">
              <span className="public-post-label">ع</span>
              <h3>صباح أهدأ، وفنجان أفضل.</h3>
              <p>تحميصنا الجديد من أصل واحد وصل — متوازن، منعش، وجاهز لأول رشفة.</p>
              <div className="public-post-visual public-post-visual-ar" />
              <small>إنستغرام · مسودة</small>
            </article>
          </div>
          <div className="public-approval-card">
            <span className="public-approval-icon"><CircleCheck size={20} aria-hidden="true" /></span>
            <div><strong>{ar ? "بانتظار اعتمادك" : "Waiting for your approval"}</strong><p>{ar ? "مسودتان جاهزتان. لا نشر تلقائي." : "Two drafts ready. Nothing publishes automatically."}</p></div>
            <span className="public-approval-action">{ar ? "راجع" : "Review"}<ArrowRight size={14} /></span>
          </div>
        </div>
      </section>

      <section className="public-section public-advantages">
        <div className="public-section-heading">
          <p className="public-eyebrow">{ar ? "لماذا تنتقل الفرق إلينا" : "Why teams switch"}</p>
          <h2>{ar ? "ثلاثة أسباب تجعل الفرق تنتقل إلى إعلاني." : "Three reasons teams switch to E3lani."}</h2>
          <p>{ar ? "سرعة الإطلاق لا تعني التخلي عن السيطرة — ومساحة عمل مبنية للعربية منذ البداية." : "A faster launch without giving up control — and a workspace built for Arabic from the start."}</p>
        </div>
        <div className="public-advantages-grid">
          <article className="public-advantage">
            <h3>{ar ? "لا يُنشر شيء حتى تقول نعم." : "Nothing publishes until you say yes."}</h3>
            <p>{ar ? <>لا يُنشر شيء من دون إنسان. وخلافاً للأدوات القائمة على المقاعد — <bdi dir="ltr">Sprout Social</bdi> من <bdi dir="rtl">299 دولارًا</bdi> للمقعد، و<bdi dir="ltr">Hootsuite</bdi> من <bdi dir="rtl">399 دولارًا</bdi> للمستخدم شهريًا، و<bdi dir="ltr">HubSpot Enterprise</bdi> بعرض سعر — الاعتماد مشمول في كل خطط إعلاني.</> : <>Nothing publishes without a person. Unlike per-seat tools — Sprout Social from $299/seat, Hootsuite from $399/user/mo, and HubSpot Enterprise by quote — approval is included in every E3lani plan.</>}</p>
          </article>
          <article className="public-advantage">
            <h3>{ar ? "مبني بالعربية. وليس مترجمًا إليها." : "Built in Arabic. Not translated into it."}</h3>
            <p>{ar ? "عربية أولاً ومن اليمين إلى اليسار، بخطوط عربية أصيلة ضمن نظام الخطوط — لا ترجمة لاحقة." : "Arabic-first RTL with Cairo, Tajawal, IBM Plex Sans Arabic and Almarai in the type stack — not a translated afterthought."}</p>
          </article>
          <article className="public-advantage">
            <h3>{ar ? "خطّط. أنشئ. وافق. انشر. قِس. في مكان واحد." : "Plan. Create. Approve. Publish. Measure. One place."}</h3>
            <p>{ar ? "خطّط، وأنشئ، واعتمد، وانشر، وقِس. مساحة عمل واحدة من الموجز إلى الدليل، لا خمس أدوات منفصلة." : "Plan, Create, Approve, Publish, Measure. One workspace from brief to evidence, not five disconnected tools."}</p>
          </article>
        </div>
        <div className="public-loop">
          <div className="public-section-heading public-loop-heading">
            <p className="public-eyebrow">{ar ? "دورة الوكلاء" : "The agent loop"}</p>
            <h2>{ar ? "من الموجز إلى الدليل، في خمس خطوات متصلة." : "From brief to evidence, in five connected steps."}</h2>
          </div>
          <ol className="public-steps public-loop-steps">
            {[
              [ar ? "خطّط" : "Plan", ar ? "الموجز والجمهور وخطة القنوات." : "Brief, audience and channel plan."],
              [ar ? "أنشئ" : "Create", ar ? "المنشورات والنصوص والتصاميم بالإنجليزية والعربية." : "Posts, copy and visuals in English and Arabic."],
              [ar ? "اعتمد" : "Approve", ar ? "يعتمد إنسان كل مخرج قبل النشر." : "A person signs off before anything ships."],
              [ar ? "انشر" : "Publish", ar ? "تنشر القنوات المرتبطة وفق الجدول." : "Connected channels publish on schedule."],
              [ar ? "قِس" : "Measure", ar ? "تعود النتائج والأدلة إلى الدورة." : "Results and evidence return to the loop."],
            ].map(([title, copy], index) => <li key={title}><span>{index + 1}</span><strong>{title}</strong><p>{copy}</p></li>)}
          </ol>
        </div>
      </section>

      <section className="public-section public-workflow">
        <div className="public-section-heading">
          <p className="public-eyebrow">{ar ? "أربع خطوات" : "Four steps"}</p>
          <h2>{ar ? "من فكرة إلى عمل جاهز للمراجعة." : "From a brief to work ready for review."}</h2>
          <p>{ar ? "إعداد واضح، ثم موجز واحد يقود الفريق، ثم قرار بشري قبل أي نشر." : "A clear setup, one brief that guides the team, then a human decision before anything ships."}</p>
        </div>
        <ol className="public-steps">
          {[
            [ar ? "عرّف نشاطك" : "Set up your business", ar ? "اسمك وقطاعك ولغتك." : "Your name, industry and languages."],
            [ar ? "التقط هويتك" : "Capture your brand", ar ? "الألوان والنبرة والخطوط." : "Colours, tone and fonts."],
            [ar ? "أضف معرفتك" : "Add approved knowledge", ar ? "حقائق وعروض موثوقة." : "Facts and offers you trust."],
            [ar ? "أطلق بمراجعة" : "Launch with review", ar ? "اعتمد كل مخرج قبل النشر." : "Approve every output before it ships."],
          ].map(([title, copy], index) => <li key={title}><span>{index + 1}</span><strong>{title}</strong><p>{copy}</p></li>)}
        </ol>
      </section>

      <section className="public-section public-pricing-preview">
        <div className="public-section-heading">
          <p className="public-eyebrow">{ar ? "أسعار واضحة" : "Simple pricing"}</p>
          <h2>{ar ? "ابدأ صغيراً، وتوسّع عندما ينمو فريقك." : "Start small. Scale when the work does."}</h2>
        </div>
        <PricingCards locale={locale} launch100Active={launch100Active} />
        <aside className="public-sandbox-callout public-sandbox-landing">
          <ShieldCheck size={20} aria-hidden="true" />
          <div><strong>{ar ? "تجربة مجانية لحملة متكاملة" : "Start with a Free 1-Campaign Sandbox"}</strong><p>{ar ? "احصل على حزمة حملة كاملة، وثلاث عمليات توليد بالذكاء الاصطناعي، دون ربط قنوات اجتماعية حقيقية. وارتقِ عندما تكون جاهزًا." : "One complete AI Campaign Work Pack and three AI runs, without live social channels. Upgrade when you are ready."}</p></div>
        </aside>
        {cohortFull ? <div className="public-waitlist"><WaitlistForm locale={locale} /></div> : null}
        <p className="public-center-link"><Link href="/pricing">{ar ? "تفاصيل الخطط والمقارنة" : "Compare plans and details"}<ArrowRight size={16} /></Link></p>
      </section>

      <section className="public-faq public-faq-landing">
        <h2>{ar ? "أسئلة الإطلاق" : "Launch questions"}</h2>
        <details><summary>{ar ? "هل إعلاني بالدعوة فقط؟" : "Is E3lani invite-only?"}</summary><p>{ar ? <>نبدأ بدفعة بالدعوة فقط من 20 مساحة عمل نشطة، ثم نتوسع إلى 100 مساحة إطلاق عبر قائمة الأولوية. سعر <bdi dir="ltr">LAUNCH100</bdi> مخصص لأول 100 مساحة عمل.</> : <>We start with an invite-only cohort of 20 active workspaces, then expand to 100 launch workspaces through the priority waitlist. <bdi dir="ltr">LAUNCH100</bdi> pricing is reserved for those first 100 workspaces.</>}</p></details>
        <details><summary>{ar ? "هل السعر لكل مساحة عمل أم لكل مقعد؟" : "Is pricing per workspace or per seat?"}</summary><p>{ar ? "سعر ثابت واحد لكل مساحة عمل، لا لكل مقعد. ادعُ فريقك دون دفع مقابل مقاعد إضافية؛ تختلف الخطط بحجم حملات الذكاء الاصطناعي والسعة. أما الأدوات القائمة على المقاعد مثل Sprout Social (من نحو 299 دولارًا للمقعد) وHootsuite (من نحو 399 دولارًا للمستخدم شهرياً) فتتقاضى عن كل شخص." : "One flat price per workspace, not per seat. Invite your team without extra seat fees; plans differ by AI campaign volume and capacity. Per-seat tools such as Sprout Social (from about $299/seat) and Hootsuite (from about $399/user/mo) charge for each person."}</p></details>
        <details><summary>{ar ? "من يملك الحملات والبيانات التي ننشئها؟" : "Who owns the campaigns and data we create?"}</summary><p>{ar ? "أنت. يبقى موجزك ومحتواك واعتماداتك ومعرفتك بالعلامة في مساحة عملك. فصل قناة تواصل يلغي رمز OAuth ويحذفه؛ ويبقى محتواك وسجل اعتمادك ملكاً لك." : "You do. Your briefs, content, approvals and brand knowledge stay in your workspace. Disconnecting a social channel revokes and purges its OAuth token; your content and approval history remain yours."}</p></details>
        <details><summary>{ar ? "ما الذي يفعله إعلاني بالضبط؟" : "What exactly does E3lani do?"}</summary><p>{ar ? "يدير تسويقك كدورة واحدة متصلة: يخطط الحملات، ويكتب النصوص، ويجهّز التصاميم بالإنجليزية والعربية، ثم ينتظر اعتماد إنسان لكل منشور قبل النشر." : "It runs your marketing as one connected loop: it plans campaigns, writes copy, prepares visuals in English and Arabic, and waits for a person to approve every post before publishing."}</p></details>
        <details><summary>{ar ? "هل العربية أصلية أم مترجمة؟" : "Is the Arabic native or translated?"}</summary><p>{ar ? "مساحة العمل مبنية للعربية من اليمين إلى اليسار، بخطوط عربية أصيلة. ويُنشأ المحتوى العربي والإنجليزي معاً، لا يُترجم في النهاية." : "The workspace is RTL-first, with Arabic typography including Cairo, Tajawal, IBM Plex Sans Arabic and Almarai. Arabic and English are created together, not translated at the end."}</p></details>
        <details><summary>{ar ? "هل أحتاج بطاقة للبدء؟" : "Do I need a card to start?"}</summary><p>{ar ? "ابدأ بتجربة مجانية لحملة متكاملة: حزمة حملة كاملة وثلاث عمليات توليد بالذكاء الاصطناعي، دون قنوات اجتماعية حقيقية ودون بطاقة." : "Start with the Free 1-Campaign Sandbox: one complete AI Campaign Work Pack and three AI runs, with no live social channels and no card required."}</p></details>
      </section>

      <section className="public-cta">
        <div><h2>{ar ? "جاهز لترى فريقك يعمل بتكامل؟" : "Ready to see your team work in step?"}</h2><p>{ar ? "أنشئ مساحة عملك، وأضف هويتك، وابدأ أول موجز اليوم." : "Create your workspace, add your brand, and start your first brief today."}</p></div>
        <Link className="public-button" href="/signup">{ar ? "ابدأ الآن" : "Get started"}<ArrowRight size={17} /></Link>
      </section>
      <PublicFooter locale={locale} />
    </main>
  );
}

export function PublicPricingPage({ locale, launch100Active = true, cohortFull = false }: { locale: Locale; launch100Active?: boolean; cohortFull?: boolean }) {
  const ar = locale === "ar";
  return (
    <main className="public-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <PublicHeader locale={locale} />
      <section className="public-inner-hero">
        <p className="public-eyebrow">{ar ? "الأسعار" : "Pricing"}</p>
        <h1>{ar ? "مساحة عمل واحدة. خطط تنمو معك." : "One workspace. Plans that grow with you."}</h1>
        <p>{ar ? "كل خطة تشمل المحتوى العربي والإنجليزي، والاعتماد البشري، وسجل التدقيق. لا مفاجآت في الفواتير." : "Every plan includes Arabic and English content, human approval and the audit trail. No billing surprises."}</p>
      </section>
      <section className="public-section">
        <PricingCards locale={locale} detailed launch100Active={launch100Active} />
        <aside className="public-sandbox-callout">
          <ShieldCheck size={20} aria-hidden="true" />
          <div><strong>{ar ? "تجربة مجانية لحملة متكاملة" : "Free 1-Campaign Sandbox"}</strong><p>{ar ? "ابدأ بتجربة مجانية بدون التزام، ثم اختر الباقة المناسبة لك. وتتم عملية الدفع بالكامل عبر Stripe بأمان." : "Start with one free campaign, no commitment, then choose the plan that fits you. Checkout is handled securely by Stripe."}</p></div>
        </aside>
        {cohortFull ? <div className="public-waitlist"><WaitlistForm locale={locale} /></div> : null}
        <p className="public-pricing-note">{ar ? "فوترة B2B بالدولار الأمريكي من شركتنا البريطانية المحدودة. خارج نطاق ضريبة القيمة المضافة البريطانية. هذه ليست عملية بيع بالتجزئة للمستهلكين في المملكة المتحدة، ولا تسري عليها حماية البيع عن بُعد للمستهلكين. نستلم المدفوعات عبر Stripe بالبطاقة أو بالتحويل البنكي. (مرجع HMRC Notice 741A)" : "B2B SaaS billed in USD by our UK Ltd entity. Outside the scope of UK VAT for international B2B customers under HMRC Notice 741A. This is not a UK consumer retail sale, and UK consumer distance-selling protections do not apply. Payments are collected through Stripe by card or bank transfer."}</p>
      </section>
      <section className="public-faq">
        <h2>{ar ? "أسئلة قبل أن تبدأ" : "Before you start"}</h2>
        <details><summary>{ar ? "هل يمكنني تجربة المساحة قبل الدفع؟" : "Can I try the workspace before paying?"}</summary><p>{ar ? "أنشئ مساحة عملك وأكمل الإعداد. تظهر إعدادات الفوترة بوضوح، ولا تُنشر أي حملة دون اعتمادك." : "Create your workspace and complete setup. Billing readiness is shown clearly, and nothing publishes without your approval."}</p></details>
        <details><summary>{ar ? "ماذا يحدث لمحتواي إذا غيّرت الخطة؟" : "What happens to my work if I change plans?"}</summary><p>{ar ? "يبقى محتواك ومسوداتك وسجل اعتمادك في مساحة عملك. تتغير حدود الخطة والمقاعد فقط." : "Your content, drafts and approval history stay in your workspace. Only plan limits and seats change."}</p></details>
        <details><summary>{ar ? "هل تنشرون تلقائياً؟" : "Do you publish automatically?"}</summary><p>{ar ? "لا. كل مخرج يبقى مسودة حتى يعتمده إنسان. وحتى النشر يمر عبر قنواتك وإعداداتك." : "No. Every output stays a draft until a person approves it. Publishing still follows your channels and settings."}</p></details>
        <details><summary>{ar ? "هل السعر لكل مساحة عمل أم لكل مقعد؟" : "Is pricing per workspace or per seat?"}</summary><p>{ar ? "سعر ثابت واحد لكل مساحة عمل، لا لكل مقعد. ادعُ فريقك دون دفع مقابل مقاعد إضافية؛ تختلف الخطط بحجم حملات الذكاء الاصطناعي والسعة. أما الأدوات القائمة على المقاعد مثل Sprout Social (من نحو 299 دولارًا للمقعد) وHootsuite (من نحو 399 دولارًا للمستخدم شهرياً) فتتقاضى عن كل شخص." : "One flat price per workspace, not per seat. Invite your team without paying for extra seats; plans differ by AI campaign volume and capacity. Per-seat tools such as Sprout Social (from about $299/seat) and Hootsuite (from about $399/user/mo) charge for each person."}</p></details>
      </section>
      <PublicFooter locale={locale} />
    </main>
  );
}

export function PublicPrivacyPage({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <main className="public-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <PublicHeader locale={locale} />
      <article className="public-document">
        <p className="public-eyebrow">{ar ? "الخصوصية" : "Privacy"}</p>
        <h1>{ar ? "بياناتك، وقنواتك، وتحت سيطرتك." : "Your data, your channels, under your control."}</h1>
        <p className="public-document-lede">{ar ? "توضح هذه السياسة ما يجمعه إعلاني، وكيف يستخدمه، وكيف يمكنك فصل قنوات التواصل الاجتماعي وحذف رموز الوصول في أي وقت." : "This policy explains what E3lani collects, how it is used, and how you can disconnect social channels and purge access tokens at any time."}</p>

        <h2>{ar ? "ما نجمعه" : "What we collect"}</h2>
        <p>{ar ? "بيانات الحساب ومساحة العمل، وملف النشاط التجاري، وهويتك البصرية، والمعرفة التي تضيفها، والموجزات والمخرجات التي تنشئها. وعند ربط قناة اجتماعية، نحتفظ برموز الوصول اللازمة للنشر بالنيابة عنك." : "Account and workspace details, your business profile, brand kit, knowledge you add, and the briefs and outputs you create. When you connect a social channel, we store the access tokens needed to publish on your behalf."}</p>

        <h2>{ar ? "كيف نستخدم البيانات" : "How we use it"}</h2>
        <p>{ar ? "لتشغيل مساحة عملك، وتوليد مسودات لفريقك، وإظهار سجل الاعتماد، وتشغيل القنوات التي ربطتها. لا نبيع بياناتك الشخصية، ولا ننشر محتوى دون اعتماد بشري." : "To run your workspace, generate drafts for your team, show approval history, and operate the channels you connected. We do not sell personal data, and we do not publish content without human approval."}</p>

        <h2>{ar ? "فصل القنوات الاجتماعية وحذف رموز الوصول" : "Disconnecting social channels and purging tokens"}</h2>
        <p>{ar ? "يمكنك فصل أي قناة اجتماعية في أي وقت من صفحة القنوات في الإعدادات: افتح الإعدادات، ثم القنوات، واختر القناة، ثم افصل. يؤدي الفصل إلى إلغاء صلاحية رموز OAuth وحذفها من مساحة عملك، ولا يمس محتواك أو سجل اعتمادك." : "You can disconnect any social channel at any time from the Channels page in Settings: open Settings, choose Channels, select the channel, then disconnect. Disconnecting revokes and purges its OAuth tokens from your workspace; your content and approval history remain."}</p>
        <p>{ar ? <>رابط مباشر: <bdi dir="ltr">/settings/channels</bdi>. إذا كنت تريد حذف مساحة العمل بالكامل أو لديك سؤال عن بياناتك، تواصل مع مشغّل إعلاني الذي أنشأ مساحتك.</> : <>Direct link: <bdi dir="ltr">/settings/channels</bdi>. If you want the whole workspace removed, or have a question about your data, contact the E3lani operator who provisioned your workspace.</>}</p>

        <h2>{ar ? "المشاركة والاحتفاظ" : "Sharing and retention"}</h2>
        <p>{ar ? "نشارك البيانات فقط مع مزوّدي الخدمات اللازمين لتشغيل المنصة، وبما يفرضه القانون. نحتفظ بالبيانات طالما بقي حسابك نشطاً أو حسب ما يقتضيه الالتزام القانوني، ثم نحذفها أو نجعلها مجهولة." : "We share data only with service providers needed to operate the platform, and where law requires it. We keep data while your account is active or as required by legal obligations, then delete or anonymise it."}</p>

        <h2>{ar ? "حقوقك" : "Your rights"}</h2>
        <p>{ar ? "يمكنك طلب الوصول إلى بياناتك أو تصحيحها أو حذفها، وسحب إذن أي قناة. نستجيب للطلبات ضمن المدة التي يفرضها القانون المعمول به." : "You can request access to, correction of, or deletion of your data, and withdraw consent for any channel. We respond within the period required by applicable law."}</p>
        <p className="public-document-note">{ar ? "آخر تحديث: 14 نوفمبر 2026." : "Last updated: 14 November 2026."}</p>
      </article>
      <PublicFooter locale={locale} />
    </main>
  );
}

export function PublicTermsPage({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <main className="public-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <PublicHeader locale={locale} />
      <article className="public-document">
        <p className="public-eyebrow">{ar ? "الشروط" : "Terms"}</p>
        <h1>{ar ? "شروط استخدام واضحة." : "Clear terms for using E3lani."}</h1>
        <p className="public-document-lede">{ar ? "تنطبق هذه الشروط على مساحة عمل إعلاني التي تستخدمها. باستخدامك المنصة، فإنك توافق عليها نيابة عن نشاطك التجاري." : "These terms apply to the E3lani workspace you use. By using the platform, you agree to them on behalf of your business."}</p>

        <h2>{ar ? "حسابك ومسؤولياتك" : "Your account and responsibilities"}</h2>
        <p>{ar ? "أنت مسؤول عن دقة بيانات نشاطك، وعن المحتوى والمعرفة التي تضيفها، وعن الحفاظ على سرية حسابات فريقك. لا ترفع بيانات غير مصرّح لك باستخدامها." : "You are responsible for the accuracy of your business details, the content and knowledge you add, and keeping your team accounts secure. Do not upload data you are not authorised to use."}</p>

        <h2>{ar ? "الاعتماد البشري والنشر" : "Human approval and publishing"}</h2>
        <p>{ar ? "مخرجات الذكاء الاصطناعي مقترحات، وليست حقائق أو وعوداً. يبقى كل مخرج مسودة حتى يعتمده إنسان مخوّل. أنت مسؤول عن مراجعة الادعاءات والأسعار والالتزام بالأنظمة قبل النشر." : "AI outputs are proposals, not facts or promises. Every output remains a draft until an authorised person approves it. You are responsible for reviewing claims, prices and legal compliance before publishing."}</p>

        <h2>{ar ? "القنوات الاجتماعية" : "Social channels"}</h2>
        <p>{ar ? <>عند ربط قناة، فإنك تأذن لإعلاني بالنشر بالنيابة عنك وفق إعداداتك. يمكنك فصل القناة وحذف رموزها في أي وقت من <bdi dir="ltr">/settings/channels</bdi> أو من صفحة القنوات في الإعدادات.</> : <>When you connect a channel, you authorise E3lani to publish on your behalf according to your settings. You can disconnect it and purge its tokens at any time from <bdi dir="ltr">/settings/channels</bdi> or the Channels page in Settings.</>}</p>

        <h2>{ar ? "الاستخدام المقبول" : "Acceptable use"}</h2>
        <p>{ar ? "لا تستخدم المنصة لإرسال رسائل غير مرغوبة، أو انتهاك حقوق الآخرين، أو نشر محتوى مضلل أو غير قانوني، أو محاولة تجاوز صلاحيات مساحة العمل." : "Do not use the platform for spam, infringement, misleading or unlawful content, or attempts to bypass workspace permissions."}</p>

        <h2>{ar ? "الاشتراك والإلغاء" : "Subscription and cancellation"}</h2>
        <p>{ar ? "تُدفع الخطط شهرياً مقدماً. يمكنك إلغاء التجديد من إعدادات الفوترة؛ يبقى وصولك حتى نهاية الفترة المدفوعة. قد تُفرض ضرائب محلية حيث ينطبق." : "Plans are billed monthly in advance. You can cancel renewal from billing settings; access continues until the end of the paid period. Local taxes may apply where required."}</p>

        <h2>{ar ? "حدود المسؤولية" : "Limits of liability"}</h2>
        <p>{ar ? "نقدم المنصة كما هي ضمن الحدود التي يسمح بها القانون. لا نضمن نتائج تسويقية محددة، ولا نتحمل مسؤولية قرارات النشر التي تتخذها بعد الاعتماد." : "We provide the platform as-is to the extent permitted by law. We do not guarantee specific marketing results and are not responsible for publishing decisions you make after approval."}</p>

        <h2>{ar ? "التغييرات والتواصل" : "Changes and contact"}</h2>
        <p>{ar ? "قد نحدّث هذه الشروط لتعكس تغييرات في المنصة أو القانون، وسنوضح تاريخ التحديث. للأسئلة، تواصل مع مشغّل إعلاني الذي أنشأ مساحتك." : "We may update these terms to reflect platform or legal changes and will show the update date. For questions, contact the E3lani operator who provisioned your workspace."}</p>
        <p className="public-document-note">{ar ? "آخر تحديث: 14 نوفمبر 2026." : "Last updated: 14 November 2026."}</p>
      </article>
      <PublicFooter locale={locale} />
    </main>
  );
}
