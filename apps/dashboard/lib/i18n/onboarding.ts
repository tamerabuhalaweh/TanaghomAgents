// Onboarding copy. English and Arabic live in one dictionary so both locales
// stay complete by construction.

import type { OnboardingIndustry } from "@/lib/onboarding-industries";
import type { CreativeLocale } from "@/lib/i18n/creative";

export interface OnboardingCopy {
  eyebrow: string;
  title: string;
  lede: string;
  stepLabel: string;
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
  industries: Record<OnboardingIndustry, string>;
}

const en: OnboardingCopy = {
  eyebrow: "Onboarding",
  title: "Business profile",
  lede: "Tell us how your business should be named in each language. You can change this later.",
  stepLabel: "Step 1 of 5 · Business profile",
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
};

const ar: OnboardingCopy = {
  eyebrow: "التهيئة",
  title: "ملف النشاط التجاري",
  lede: "أخبرنا كيف يظهر اسم نشاطك في كل لغة. يمكنك تغيير ذلك لاحقًا.",
  stepLabel: "الخطوة ١ من ٥ · ملف النشاط التجاري",
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
};

export const onboardingStrings: Record<CreativeLocale, OnboardingCopy> = { en, ar };

export function onboardingCopy(locale: CreativeLocale): OnboardingCopy {
  return onboardingStrings[locale];
}
