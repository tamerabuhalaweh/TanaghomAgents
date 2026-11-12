// Onboarding copy. English and Arabic live in one dictionary so both locales
// stay complete by construction.

import type { OnboardingIndustry } from "@/lib/onboarding-industries";
import type { OnboardingKnowledgeCategory } from "@/lib/onboarding-knowledge";
import type { CreativeLocale } from "@/lib/i18n/creative";

export interface OnboardingCopy {
  eyebrow: string;
  title: string;
  lede: string;
  profileTitle: string;
  stepLabel: string;
  step2Label: string;
  step3Label: string;
  stepperLabel: string;
  next: string;
  back: string;
  finish: string;
  englishNameLabel: string;
  englishNameHint: string;
  arabicNameLabel: string;
  arabicNameHint: string;
  industryLabel: string;
  industryPlaceholder: string;
  locationLabel: string;
  locationPlaceholder: string;
  previewTitle: string;
  previewEn: string;
  previewAr: string;
  canonicalNote: string;
  save: string;
  saving: string;
  saved: string;
  error: string;
  loading: string;
  loadError: string;
  brandTitle: string;
  brandLede: string;
  brandNameLabel: string;
  brandNameHint: string;
  primaryColorLabel: string;
  accentColorLabel: string;
  toneLabel: string;
  tonePlaceholder: string;
  arabicFontLabel: string;
  latinFontLabel: string;
  fontPlaceholder: string;
  brandSave: string;
  brandSaving: string;
  brandSaved: string;
  brandExisting: string;
  brandExistingHint: string;
  brandDisabled: string;
  brandError: string;
  brandLoading: string;
  brandOpen: string;
  brandInvalidColor: string;
  knowledgeTitle: string;
  knowledgeLede: string;
  knowledgeSourceKeyLabel: string;
  knowledgeSourceKeyHint: string;
  knowledgeTitleLabel: string;
  knowledgeTitlePlaceholder: string;
  knowledgeCategoryLabel: string;
  knowledgeLanguageLabel: string;
  knowledgeContentLabel: string;
  knowledgeContentPlaceholder: string;
  knowledgeContentHint: string;
  knowledgeSave: string;
  knowledgeSaving: string;
  knowledgeSaved: string;
  knowledgeExisting: string;
  knowledgeError: string;
  knowledgeLoading: string;
  knowledgeOpen: string;
  knowledgeDraftNote: string;
  industries: Record<OnboardingIndustry, string>;
  knowledgeCategories: Record<OnboardingKnowledgeCategory, string>;
  languages: { en: string; ar: string };
}

const en: OnboardingCopy = {
  eyebrow: "Onboarding",
  title: "Set up your workspace",
  lede: "Three short steps: name your business, capture your brand, and add the first approved answer your agents can use.",
  profileTitle: "Business profile",
  stepLabel: "Step 1 of 5 · Business profile",
  step2Label: "Step 2 of 5 · Brand kit",
  step3Label: "Step 3 of 5 · First knowledge",
  stepperLabel: "Onboarding steps",
  next: "Continue",
  back: "Back",
  finish: "Go to dashboard",
  englishNameLabel: "Business name (English)",
  englishNameHint: "Shown in the English interface. Leave empty to use your workspace name.",
  arabicNameLabel: "Business name (Arabic)",
  arabicNameHint: "Shown in the Arabic interface and in Arabic content.",
  industryLabel: "Industry",
  industryPlaceholder: "Choose an industry",
  locationLabel: "Location",
  locationPlaceholder: "City or region",
  previewTitle: "How your name appears",
  previewEn: "English",
  previewAr: "Arabic",
  canonicalNote: "Your workspace keeps its original name for records and links. These names only change what customers see.",
  save: "Save profile",
  saving: "Saving…",
  saved: "Business profile saved.",
  error: "The profile could not be saved. Check the details and try again.",
  loading: "Loading your profile…",
  loadError: "Your profile could not be loaded. Reload the page to try again.",
  brandTitle: "Brand kit",
  brandLede: "These are the colours, tone, and fonts every generated post and design starts from. You can refine them later in Creative Studio.",
  brandNameLabel: "Brand kit name",
  brandNameHint: "Defaults to your business name. Use a name your team recognises.",
  primaryColorLabel: "Primary colour",
  accentColorLabel: "Accent colour (optional)",
  toneLabel: "Tone of voice",
  tonePlaceholder: "Warm, confident, and plain-spoken",
  arabicFontLabel: "Arabic font",
  latinFontLabel: "Latin font",
  fontPlaceholder: "Leave empty to use the studio default",
  brandSave: "Save brand kit",
  brandSaving: "Saving brand kit…",
  brandSaved: "Brand kit saved. Your first version is now the current one.",
  brandExisting: "You already have a brand kit",
  brandExistingHint: "New posts will use its current version. Open Creative Studio to add a new version without changing past work.",
  brandDisabled: "Creative Studio is not enabled for this workspace, so the brand kit cannot be saved yet. Ask your operator to enable it, then return to this step.",
  brandError: "The brand kit could not be saved. Check the name and colours, then try again.",
  brandLoading: "Checking your brand kit…",
  brandOpen: "Open brand kits",
  brandInvalidColor: "Use a six-digit hex colour, for example #1F6F5C.",
  knowledgeTitle: "First knowledge",
  knowledgeLede: "Add one approved fact, FAQ, or offer. It is saved as a draft: a reviewer must approve and activate it before agents can use it.",
  knowledgeSourceKeyLabel: "Source key",
  knowledgeSourceKeyHint: "A stable identifier for this subject. Adding a new draft with the same key creates a new version instead of overwriting approved text.",
  knowledgeTitleLabel: "Title",
  knowledgeTitlePlaceholder: "Delivery areas and times",
  knowledgeCategoryLabel: "Category",
  knowledgeLanguageLabel: "Language",
  knowledgeContentLabel: "Approved answer material",
  knowledgeContentPlaceholder: "Write only customer-supplied facts and wording that a reviewer can verify.",
  knowledgeContentHint: "Do not include passwords, access tokens, payment card data, or unnecessary personal information.",
  knowledgeSave: "Save draft",
  knowledgeSaving: "Saving draft…",
  knowledgeSaved: "Draft saved. Review and activate it in Knowledge before agents can use it.",
  knowledgeExisting: "Your knowledge base already has sources. This step adds one more draft; you can continue the catalogue in Knowledge.",
  knowledgeError: "The draft could not be saved. Check the source key, title, and content, then try again.",
  knowledgeLoading: "Checking your knowledge base…",
  knowledgeOpen: "Open knowledge",
  knowledgeDraftNote: "Saving creates a draft only. Nothing reaches customers until a reviewer approves and activates it.",
  industries: {
    retail_ecommerce: "Retail and e-commerce",
    food_hospitality: "Food and hospitality",
    services_consulting: "Services and consulting",
    education_training: "Education and training",
    health_wellness: "Health and wellness",
    beauty_personal_care: "Beauty and personal care",
    real_estate: "Real estate",
    creative_media: "Creative and media",
    technology: "Technology",
    nonprofit: "Nonprofit",
    other: "Other",
  },
  knowledgeCategories: {
    product: "Product",
    service: "Service",
    pricing: "Pricing",
    faq: "FAQ",
    policy: "Policy",
    offer: "Offer",
    location: "Location",
    hours: "Opening hours",
  },
  languages: { en: "English", ar: "Arabic" },
};

const ar: OnboardingCopy = {
  eyebrow: "التهيئة",
  title: "جهّز مساحة عملك",
  lede: "ثلاث خطوات قصيرة: سمِّ نشاطك، والتقط هويتك البصرية، وأضف أول إجابة معتمدة يستخدمها وكلاؤك.",
  profileTitle: "ملف النشاط التجاري",
  stepLabel: "الخطوة ١ من ٥ · ملف النشاط التجاري",
  step2Label: "الخطوة ٢ من ٥ · الهوية البصرية",
  step3Label: "الخطوة ٣ من ٥ · أول معرفة",
  stepperLabel: "خطوات التهيئة",
  next: "متابعة",
  back: "رجوع",
  finish: "الذهاب إلى لوحة التحكم",
  englishNameLabel: "اسم النشاط (بالإنجليزية)",
  englishNameHint: "يظهر في الواجهة الإنجليزية. اتركه فارغًا لاستخدام اسم مساحة العمل.",
  arabicNameLabel: "اسم النشاط (بالعربية)",
  arabicNameHint: "يظهر في الواجهة العربية وفي المحتوى العربي.",
  industryLabel: "القطاع",
  industryPlaceholder: "اختر القطاع",
  locationLabel: "الموقع",
  locationPlaceholder: "المدينة أو المنطقة",
  previewTitle: "كيف يظهر اسمك",
  previewEn: "بالإنجليزية",
  previewAr: "بالعربية",
  canonicalNote: "تحتفظ مساحة عملك باسمها الأصلي في السجلات والروابط. هذه الأسماء تغيّر ما يراه العملاء فقط.",
  save: "حفظ الملف",
  saving: "جارٍ الحفظ…",
  saved: "تم حفظ ملف النشاط التجاري.",
  error: "تعذّر حفظ الملف. تحقّق من البيانات وحاول مرة أخرى.",
  loading: "جارٍ تحميل ملفك…",
  loadError: "تعذّر تحميل ملفك. أعد تحميل الصفحة للمحاولة.",
  brandTitle: "الهوية البصرية",
  brandLede: "هذه هي الألوان والنبرة والخطوط التي يبدأ منها كل منشور وتصميم. يمكنك تحسينها لاحقًا في استوديو الإبداع.",
  brandNameLabel: "اسم الهوية البصرية",
  brandNameHint: "يستخدم اسم نشاطك افتراضيًا. اختر اسمًا يعرفه فريقك.",
  primaryColorLabel: "اللون الأساسي",
  accentColorLabel: "اللون الثانوي (اختياري)",
  toneLabel: "نبرة الصوت",
  tonePlaceholder: "دافئة وواثقة وبسيطة",
  arabicFontLabel: "الخط العربي",
  latinFontLabel: "الخط اللاتيني",
  fontPlaceholder: "اتركه فارغًا لاستخدام الخط الافتراضي للاستوديو",
  brandSave: "حفظ الهوية البصرية",
  brandSaving: "جارٍ حفظ الهوية…",
  brandSaved: "تم حفظ الهوية البصرية. أصبحت نسختك الأولى هي الحالية.",
  brandExisting: "لديك هوية بصرية بالفعل",
  brandExistingHint: "ستستخدم المنشورات الجديدة نسختها الحالية. افتح استوديو الإبداع لإضافة نسخة جديدة دون تغيير الأعمال السابقة.",
  brandDisabled: "استوديو الإبداع غير مفعّل لمساحة العمل هذه، لذا لا يمكن حفظ الهوية البصرية الآن. اطلب من مشغّلك تفعيله ثم عد إلى هذه الخطوة.",
  brandError: "تعذّر حفظ الهوية البصرية. تحقّق من الاسم والألوان وحاول مرة أخرى.",
  brandLoading: "جارٍ التحقق من هويتك البصرية…",
  brandOpen: "فتح الهويات البصرية",
  brandInvalidColor: "استخدم لونًا سداسيًا بصيغة hex، مثل ‎#1F6F5C‎.",
  knowledgeTitle: "أول معرفة",
  knowledgeLede: "أضف حقيقة أو سؤالًا شائعًا أو عرضًا معتمدًا واحدًا. يُحفظ كمسودة: يجب أن يراجعها معتمِد ويفعّلها قبل أن يستخدمها الوكلاء.",
  knowledgeSourceKeyLabel: "مفتاح المصدر",
  knowledgeSourceKeyHint: "معرّف ثابت لهذا الموضوع. إضافة مسودة جديدة بالمفتاح نفسه تنشئ نسخة جديدة بدل استبدال النص المعتمد.",
  knowledgeTitleLabel: "العنوان",
  knowledgeTitlePlaceholder: "مناطق وأوقات التوصيل",
  knowledgeCategoryLabel: "الفئة",
  knowledgeLanguageLabel: "اللغة",
  knowledgeContentLabel: "مادة الإجابة المعتمدة",
  knowledgeContentPlaceholder: "اكتب فقط الحقائق والصياغة التي قدّمها العميل ويمكن للمراجع التحقق منها.",
  knowledgeContentHint: "لا تُدرج كلمات مرور أو رموز وصول أو بيانات بطاقات دفع أو معلومات شخصية غير ضرورية.",
  knowledgeSave: "حفظ المسودة",
  knowledgeSaving: "جارٍ حفظ المسودة…",
  knowledgeSaved: "تم حفظ المسودة. راجعها وفعّلها في المعرفة قبل أن يستخدمها الوكلاء.",
  knowledgeExisting: "تحتوي قاعدة معرفتك على مصادر بالفعل. تضيف هذه الخطوة مسودة أخرى؛ يمكنك متابعة الكتالوج في المعرفة.",
  knowledgeError: "تعذّر حفظ المسودة. تحقّق من مفتاح المصدر والعنوان والمحتوى وحاول مرة أخرى.",
  knowledgeLoading: "جارٍ التحقق من قاعدة معرفتك…",
  knowledgeOpen: "فتح المعرفة",
  knowledgeDraftNote: "الحفظ ينشئ مسودة فقط. لا يصل شيء إلى العملاء حتى يعتمدها مراجع ويفعّلها.",
  industries: {
    retail_ecommerce: "التجزئة والتجارة الإلكترونية",
    food_hospitality: "الأغذية والضيافة",
    services_consulting: "الخدمات والاستشارات",
    education_training: "التعليم والتدريب",
    health_wellness: "الصحة والعافية",
    beauty_personal_care: "الجمال والعناية الشخصية",
    real_estate: "العقارات",
    creative_media: "الإبداع والإعلام",
    technology: "التقنية",
    nonprofit: "القطاع غير الربحي",
    other: "أخرى",
  },
  knowledgeCategories: {
    product: "منتج",
    service: "خدمة",
    pricing: "الأسعار",
    faq: "الأسئلة الشائعة",
    policy: "السياسات",
    offer: "العروض",
    location: "الموقع",
    hours: "ساعات العمل",
  },
  languages: { en: "الإنجليزية", ar: "العربية" },
};

export const onboardingStrings: Record<CreativeLocale, OnboardingCopy> = { en, ar };

export function onboardingCopy(locale: CreativeLocale): OnboardingCopy {
  return onboardingStrings[locale];
}
