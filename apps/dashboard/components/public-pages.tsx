import Link from "next/link";
import { ArrowRight, Check, CircleCheck, ShieldCheck, Sparkles } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { LocaleToggle } from "@/components/creative/locale-toggle";
import type { CreativeLocale } from "@/lib/i18n/creative";

type Locale = CreativeLocale;

function PublicHeader({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <header className="public-header">
      <Link className="public-brand" href="/" aria-label="Tanaghom">
        <BrandMark />
        <span>Tanaghom</span>
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
        <Link className="public-brand" href="/"><BrandMark /><span>Tanaghom</span></Link>
        <p>{ar ? "تناغم يمنح فرق التسويق مساحة عمل ثنائية اللغة تعمل بالذكاء الاصطناعي، مع اعتماد بشري واضح لكل ما يصل إلى العملاء." : "Tanaghom gives marketing teams a bilingual AI workspace with clear human approval for everything that reaches customers."}</p>
      </div>
      <nav aria-label={ar ? "روابط التذييل" : "Footer links"}>
        <Link href="/pricing">{ar ? "الأسعار" : "Pricing"}</Link>
        <Link href="/privacy">{ar ? "الخصوصية" : "Privacy"}</Link>
        <Link href="/terms">{ar ? "الشروط" : "Terms"}</Link>
        <Link href="/login">{ar ? "تسجيل الدخول" : "Sign in"}</Link>
      </nav>
      <p className="public-copyright">© {new Date().getFullYear()} Tanaghom</p>
    </footer>
  );
}

const tiers = [
  {
    id: "starter",
    en: { name: "Starter", price: "£249", period: "per month", lede: "For one brand finding its rhythm.", features: ["1 workspace", "2 team seats", "4 AI specialists", "Arabic and English content"] },
    ar: { name: "البداية", price: "£249", period: "شهرياً", lede: "لعلامة واحدة تبحث عن إيقاعها.", features: ["مساحة عمل واحدة", "مقعدان للفريق", "٤ مختصين بالذكاء الاصطناعي", "محتوى عربي وإنجليزي"] },
  },
  {
    id: "growth",
    en: { name: "Growth", price: "£499", period: "per month", lede: "For teams running always-on campaigns.", features: ["1 workspace", "8 team seats", "All AI specialists", "Brand kits and approvals", "Knowledge base and reports"] },
    ar: { name: "النمو", price: "£499", period: "شهرياً", lede: "للفرق التي تدير حملات مستمرة.", features: ["مساحة عمل واحدة", "٨ مقاعد للفريق", "جميع المختصين", "هويات بصرية واعتمادات", "قاعدة معرفة وتقارير"] },
    featured: true,
  },
  {
    id: "scale",
    en: { name: "Scale", price: "£799", period: "per month", lede: "For agencies coordinating multiple brands.", features: ["Multiple brand workspaces", "Priority onboarding", "Advanced roles and reviews", "Operational monitoring", "Guided rollout"] },
    ar: { name: "التوسع", price: "£799", period: "شهرياً", lede: "للوكالات التي تنسّق علامات متعددة.", features: ["مساحات عمل متعددة", "تهيئة ذات أولوية", "أدوار ومراجعات متقدمة", "مراقبة تشغيلية", "طرح موجّه"] },
  },
] as const;

function PricingCards({ locale, detailed = false }: { locale: Locale; detailed?: boolean }) {
  const ar = locale === "ar";
  return (
    <div className={`public-pricing-grid ${detailed ? "public-pricing-detailed" : ""}`}>
      {tiers.map((tier) => {
        const text = ar ? tier.ar : tier.en;
        return (
          <article key={tier.id} className={`public-price-card ${"featured" in tier && tier.featured ? "public-price-featured" : ""}`}>
            {"featured" in tier && tier.featured ? <span className="public-price-tag">{ar ? "الأكثر اختياراً" : "Most popular"}</span> : null}
            <h3>{text.name}</h3>
            <p className="public-price-lede">{text.lede}</p>
            <div className="public-price-value"><strong dir="ltr">{text.price}</strong><span>{text.period}</span></div>
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

export function PublicLandingPage({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  return (
    <main className="public-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <PublicHeader locale={locale} />
      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="public-eyebrow"><Sparkles size={15} aria-hidden="true" />{ar ? "ذكاء اصطناعي تحت إشرافك" : "AI with your hand on the wheel"}</p>
          <h1>{ar ? "حملات أسرع، وقرارات تبقى بيدك." : "Campaigns move faster when people stay in control."}</h1>
          <p className="public-hero-lede">{ar ? "تناغم يجمع فريقاً من مختصي الذكاء الاصطناعي في مساحة عمل ثنائية اللغة، يخططون ويكتبون ويصممون، بينما يعتمد فريقك كل شيء قبل النشر." : "Tanaghom gives your team a bilingual AI specialist team that plans, writes and designs — while your people approve every piece before it goes live."}</p>
          <div className="public-hero-actions">
            <Link className="public-button" href="/signup">{ar ? "أنشئ مساحة عملك" : "Create your workspace"}<ArrowRight size={17} /></Link>
            <Link className="public-button public-button-outline" href="/login">{ar ? "تسجيل الدخول" : "Sign in"}</Link>
          </div>
          <p className="public-trust"><ShieldCheck size={18} aria-hidden="true" />{ar ? "اعتماد بشري وسجل تدقيق غير قابل للتغيير في كل خطوة." : "Human approval and an immutable audit trail at every step."}</p>
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
        <PricingCards locale={locale} />
        <p className="public-center-link"><Link href="/pricing">{ar ? "تفاصيل الخطط والمقارنة" : "Compare plans and details"}<ArrowRight size={16} /></Link></p>
      </section>

      <section className="public-cta">
        <div><h2>{ar ? "جاهز لترى فريقك يعمل بتناغم؟" : "Ready to see your team work in step?"}</h2><p>{ar ? "أنشئ مساحة عملك، وأضف هويتك، وابدأ أول موجز اليوم." : "Create your workspace, add your brand, and start your first brief today."}</p></div>
        <Link className="public-button" href="/signup">{ar ? "ابدأ الآن" : "Get started"}<ArrowRight size={17} /></Link>
      </section>
      <PublicFooter locale={locale} />
    </main>
  );
}

export function PublicPricingPage({ locale }: { locale: Locale }) {
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
        <PricingCards locale={locale} detailed />
        <p className="public-pricing-note">{ar ? "الأسعار بالجنيه الإسترليني، تُدفع شهرياً. يمكنك تغيير خطتك أو إلغاؤها من إعدادات الفوترة. قد تُفرض ضرائب محلية حيث ينطبق." : "Prices are in British pounds, billed monthly. Change or cancel your plan from billing settings. Local taxes may apply."}</p>
      </section>
      <section className="public-faq">
        <h2>{ar ? "أسئلة قبل أن تبدأ" : "Before you start"}</h2>
        <details><summary>{ar ? "هل يمكنني تجربة المساحة قبل الدفع؟" : "Can I try the workspace before paying?"}</summary><p>{ar ? "أنشئ مساحة عملك وأكمل الإعداد. تظهر إعدادات الفوترة بوضوح، ولا تُنشر أي حملة دون اعتمادك." : "Create your workspace and complete setup. Billing readiness is shown clearly, and nothing publishes without your approval."}</p></details>
        <details><summary>{ar ? "ماذا يحدث لمحتواي إذا غيّرت الخطة؟" : "What happens to my work if I change plans?"}</summary><p>{ar ? "يبقى محتواك ومسوداتك وسجل اعتمادك في مساحة عملك. تتغير حدود الخطة والمقاعد فقط." : "Your content, drafts and approval history stay in your workspace. Only plan limits and seats change."}</p></details>
        <details><summary>{ar ? "هل تنشرون تلقائياً؟" : "Do you publish automatically?"}</summary><p>{ar ? "لا. كل مخرج يبقى مسودة حتى يعتمده إنسان. وحتى النشر يمر عبر قنواتك وإعداداتك." : "No. Every output stays a draft until a person approves it. Publishing still follows your channels and settings."}</p></details>
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
        <p className="public-document-lede">{ar ? "توضح هذه السياسة ما يجمعه تناغم، وكيف يستخدمه، وكيف يمكنك فصل قنوات التواصل الاجتماعي وحذف رموز الوصول في أي وقت." : "This policy explains what Tanaghom collects, how it is used, and how you can disconnect social channels and purge access tokens at any time."}</p>

        <h2>{ar ? "ما نجمعه" : "What we collect"}</h2>
        <p>{ar ? "بيانات الحساب ومساحة العمل، وملف النشاط التجاري، وهويتك البصرية، والمعرفة التي تضيفها، والموجزات والمخرجات التي تنشئها. وعند ربط قناة اجتماعية، نحتفظ برموز الوصول اللازمة للنشر بالنيابة عنك." : "Account and workspace details, your business profile, brand kit, knowledge you add, and the briefs and outputs you create. When you connect a social channel, we store the access tokens needed to publish on your behalf."}</p>

        <h2>{ar ? "كيف نستخدم البيانات" : "How we use it"}</h2>
        <p>{ar ? "لتشغيل مساحة عملك، وتوليد مسودات لفريقك، وإظهار سجل الاعتماد، وتشغيل القنوات التي ربطتها. لا نبيع بياناتك الشخصية، ولا ننشر محتوى دون اعتماد بشري." : "To run your workspace, generate drafts for your team, show approval history, and operate the channels you connected. We do not sell personal data, and we do not publish content without human approval."}</p>

        <h2>{ar ? "فصل القنوات الاجتماعية وحذف رموز الوصول" : "Disconnecting social channels and purging tokens"}</h2>
        <p>{ar ? "يمكنك فصل أي قناة اجتماعية في أي وقت من صفحة القنوات في الإعدادات: افتح الإعدادات، ثم القنوات، واختر القناة، ثم افصل. يؤدي الفصل إلى إلغاء صلاحية رموز OAuth وحذفها من مساحة عملك، ولا يمس محتواك أو سجل اعتمادك." : "You can disconnect any social channel at any time from the Channels page in Settings: open Settings, choose Channels, select the channel, then disconnect. Disconnecting revokes and purges its OAuth tokens from your workspace; your content and approval history remain."}</p>
        <p>{ar ? "رابط مباشر: /settings/channels. إذا كنت تريد حذف مساحة العمل بالكامل أو لديك سؤال عن بياناتك، تواصل مع مشغّل تناغم الذي أنشأ مساحتك." : "Direct link: /settings/channels. If you want the whole workspace removed, or have a question about your data, contact the Tanaghom operator who provisioned your workspace."}</p>

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
        <h1>{ar ? "شروط استخدام واضحة." : "Clear terms for using Tanaghom."}</h1>
        <p className="public-document-lede">{ar ? "تنطبق هذه الشروط على مساحة عمل تناغم التي تستخدمها. باستخدامك المنصة، فإنك توافق عليها نيابة عن نشاطك التجاري." : "These terms apply to the Tanaghom workspace you use. By using the platform, you agree to them on behalf of your business."}</p>

        <h2>{ar ? "حسابك ومسؤولياتك" : "Your account and responsibilities"}</h2>
        <p>{ar ? "أنت مسؤول عن دقة بيانات نشاطك، وعن المحتوى والمعرفة التي تضيفها، وعن الحفاظ على سرية حسابات فريقك. لا ترفع بيانات غير مصرّح لك باستخدامها." : "You are responsible for the accuracy of your business details, the content and knowledge you add, and keeping your team accounts secure. Do not upload data you are not authorised to use."}</p>

        <h2>{ar ? "الاعتماد البشري والنشر" : "Human approval and publishing"}</h2>
        <p>{ar ? "مخرجات الذكاء الاصطناعي مقترحات، وليست حقائق أو وعوداً. يبقى كل مخرج مسودة حتى يعتمده إنسان مخوّل. أنت مسؤول عن مراجعة الادعاءات والأسعار والالتزام بالأنظمة قبل النشر." : "AI outputs are proposals, not facts or promises. Every output remains a draft until an authorised person approves it. You are responsible for reviewing claims, prices and legal compliance before publishing."}</p>

        <h2>{ar ? "القنوات الاجتماعية" : "Social channels"}</h2>
        <p>{ar ? "عند ربط قناة، فإنك تأذن لتناغم بالنشر بالنيابة عنك وفق إعداداتك. يمكنك فصل القناة وحذف رموزها في أي وقت من /settings/channels أو من صفحة القنوات في الإعدادات." : "When you connect a channel, you authorise Tanaghom to publish on your behalf according to your settings. You can disconnect it and purge its tokens at any time from /settings/channels or the Channels page in Settings."}</p>

        <h2>{ar ? "الاستخدام المقبول" : "Acceptable use"}</h2>
        <p>{ar ? "لا تستخدم المنصة لإرسال رسائل غير مرغوبة، أو انتهاك حقوق الآخرين، أو نشر محتوى مضلل أو غير قانوني، أو محاولة تجاوز صلاحيات مساحة العمل." : "Do not use the platform for spam, infringement, misleading or unlawful content, or attempts to bypass workspace permissions."}</p>

        <h2>{ar ? "الاشتراك والإلغاء" : "Subscription and cancellation"}</h2>
        <p>{ar ? "تُدفع الخطط شهرياً مقدماً. يمكنك إلغاء التجديد من إعدادات الفوترة؛ يبقى وصولك حتى نهاية الفترة المدفوعة. قد تُفرض ضرائب محلية حيث ينطبق." : "Plans are billed monthly in advance. You can cancel renewal from billing settings; access continues until the end of the paid period. Local taxes may apply where required."}</p>

        <h2>{ar ? "حدود المسؤولية" : "Limits of liability"}</h2>
        <p>{ar ? "نقدم المنصة كما هي ضمن الحدود التي يسمح بها القانون. لا نضمن نتائج تسويقية محددة، ولا نتحمل مسؤولية قرارات النشر التي تتخذها بعد الاعتماد." : "We provide the platform as-is to the extent permitted by law. We do not guarantee specific marketing results and are not responsible for publishing decisions you make after approval."}</p>

        <h2>{ar ? "التغييرات والتواصل" : "Changes and contact"}</h2>
        <p>{ar ? "قد نحدّث هذه الشروط لتعكس تغييرات في المنصة أو القانون، وسنوضح تاريخ التحديث. للأسئلة، تواصل مع مشغّل تناغم الذي أنشأ مساحتك." : "We may update these terms to reflect platform or legal changes and will show the update date. For questions, contact the Tanaghom operator who provisioned your workspace."}</p>
        <p className="public-document-note">{ar ? "آخر تحديث: 14 نوفمبر 2026." : "Last updated: 14 November 2026."}</p>
      </article>
      <PublicFooter locale={locale} />
    </main>
  );
}
