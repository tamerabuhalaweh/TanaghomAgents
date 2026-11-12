// Sign-up and session-management copy. English and Arabic are declared in one
// dictionary so both locales stay complete by construction.

import type { CreativeLocale } from "@/lib/i18n/creative";

export interface AuthCopy {
  signupEyebrow: string;
  signupTitle: string;
  signupLede: string;
  organizationLabel: string;
  organizationPlaceholder: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  passwordLabel: string;
  passwordHint: string;
  submit: string;
  submitting: string;
  haveAccount: string;
  signIn: string;
  signupError: string;
  emailTaken: string;
  passwordTooShort: string;
  passwordTooSimple: string;
  passwordTooCommon: string;
  sessionsTitle: string;
  sessionsLede: string;
  sessionsCurrent: string;
  sessionsLastSeen: string;
  sessionsRevoke: string;
  sessionsRevoking: string;
  sessionsEmpty: string;
  sessionsError: string;
  sessionsRevoked: string;
}

const en: AuthCopy = {
  signupEyebrow: "New workspace",
  signupTitle: "Create your workspace",
  signupLede: "Your organization gets its own private space. You are the owner, and nothing is shared with other tenants.",
  organizationLabel: "Organization name",
  organizationPlaceholder: "Your business name",
  nameLabel: "Your name",
  namePlaceholder: "Full name",
  emailLabel: "Work email",
  passwordLabel: "Password",
  passwordHint: "At least 12 characters. Avoid your email address and common phrases.",
  submit: "Create workspace",
  submitting: "Creating workspace…",
  haveAccount: "Already have an account?",
  signIn: "Sign in",
  signupError: "The workspace could not be created. Check the details and try again.",
  emailTaken: "An account with this email already exists. Sign in instead.",
  passwordTooShort: "Use at least 12 characters.",
  passwordTooSimple: "Use a password with more distinct characters.",
  passwordTooCommon: "That password is too common. Choose a different one.",
  sessionsTitle: "Active sessions",
  sessionsLede: "Each browser that signed in is listed here. Revoke anything you do not recognize.",
  sessionsCurrent: "This session",
  sessionsLastSeen: "Last active",
  sessionsRevoke: "Revoke",
  sessionsRevoking: "Revoking…",
  sessionsEmpty: "No other sessions are active.",
  sessionsError: "Sessions could not be loaded. Retry in a moment.",
  sessionsRevoked: "Session revoked.",
};

const ar: AuthCopy = {
  signupEyebrow: "مساحة عمل جديدة",
  signupTitle: "أنشئ مساحة عملك",
  signupLede: "تحصل مؤسستك على مساحة خاصة بها. أنت المالك، ولا تُشارك بياناتك مع أي مؤسسة أخرى.",
  organizationLabel: "اسم المؤسسة",
  organizationPlaceholder: "اسم نشاطك التجاري",
  nameLabel: "اسمك",
  namePlaceholder: "الاسم الكامل",
  emailLabel: "البريد الإلكتروني للعمل",
  passwordLabel: "كلمة المرور",
  passwordHint: "١٢ حرفًا على الأقل. تجنّب بريدك الإلكتروني والعبارات الشائعة.",
  submit: "إنشاء مساحة العمل",
  submitting: "جارٍ إنشاء مساحة العمل…",
  haveAccount: "لديك حساب بالفعل؟",
  signIn: "تسجيل الدخول",
  signupError: "تعذّر إنشاء مساحة العمل. تحقّق من البيانات وحاول مرة أخرى.",
  emailTaken: "يوجد حساب بهذا البريد الإلكتروني. سجّل الدخول بدلًا من ذلك.",
  passwordTooShort: "استخدم ١٢ حرفًا على الأقل.",
  passwordTooSimple: "استخدم كلمة مرور بأحرف أكثر تنوعًا.",
  passwordTooCommon: "كلمة المرور شائعة جدًا. اختر كلمة أخرى.",
  sessionsTitle: "الجلسات النشطة",
  sessionsLede: "يظهر هنا كل متصفح سجّل الدخول. أنهِ أي جلسة لا تعرفها.",
  sessionsCurrent: "هذه الجلسة",
  sessionsLastSeen: "آخر نشاط",
  sessionsRevoke: "إنهاء",
  sessionsRevoking: "جارٍ الإنهاء…",
  sessionsEmpty: "لا توجد جلسات أخرى نشطة.",
  sessionsError: "تعذّر تحميل الجلسات. أعد المحاولة بعد قليل.",
  sessionsRevoked: "تم إنهاء الجلسة.",
};

export const authStrings: Record<CreativeLocale, AuthCopy> = { en, ar };

export function authCopy(locale: CreativeLocale): AuthCopy {
  return authStrings[locale];
}
