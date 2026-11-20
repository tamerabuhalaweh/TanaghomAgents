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
  sessionsEyebrow: string;
  sessionsLede: string;
  sessionsCurrent: string;
  sessionsLastSeen: string;
  sessionsSignedIn: string;
  sessionsIpLabel: string;
  sessionsRevoke: string;
  sessionsRevoking: string;
  sessionsRevokeOthers: string;
  sessionsRevokingOthers: string;
  sessionsOthersRevoked: string;
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
  sessionsEyebrow: "Account security",
  sessionsLede: "Each active browser or device signed in to your account is listed below. Revoke any session you do not recognize.",
  sessionsCurrent: "This session",
  sessionsLastSeen: "Last active",
  sessionsSignedIn: "Signed in",
  sessionsIpLabel: "IP",
  sessionsRevoke: "Revoke",
  sessionsRevoking: "Revoking…",
  sessionsRevokeOthers: "Revoke all other sessions",
  sessionsRevokingOthers: "Revoking other sessions…",
  sessionsOthersRevoked: "All other sessions have been revoked.",
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
  passwordHint: "12 حرفًا على الأقل. تجنّب بريدك الإلكتروني والعبارات الشائعة.",
  submit: "إنشاء مساحة العمل",
  submitting: "جارٍ إنشاء مساحة العمل…",
  haveAccount: "لديك حساب بالفعل؟",
  signIn: "تسجيل الدخول",
  signupError: "تعذّر إنشاء مساحة العمل. تحقّق من البيانات وحاول مرة أخرى.",
  emailTaken: "يوجد حساب بهذا البريد الإلكتروني. سجّل الدخول بدلًا من ذلك.",
  passwordTooShort: "استخدم 12 حرفًا على الأقل.",
  passwordTooSimple: "استخدم كلمة مرور بأحرف أكثر تنوعًا.",
  passwordTooCommon: "كلمة المرور شائعة جدًا. اختر كلمة أخرى.",
  sessionsTitle: "الجلسات النشطة",
  sessionsEyebrow: "أمان الحساب",
  sessionsLede: "تظهر أدناه كل جلسة متصفح أو جهاز نشطة حاليًا لحسابك. أنهِ أي جلسة لا تعرفها.",
  sessionsCurrent: "هذه الجلسة",
  sessionsLastSeen: "آخر نشاط",
  sessionsSignedIn: "تاريخ الدخول",
  sessionsIpLabel: "عنوان IP",
  sessionsRevoke: "إنهاء",
  sessionsRevoking: "جارٍ الإنهاء…",
  sessionsRevokeOthers: "إنهاء جميع الجلسات الأخرى",
  sessionsRevokingOthers: "جارٍ إنهاء الجلسات الأخرى…",
  sessionsOthersRevoked: "تم إنهاء جميع الجلسات الأخرى.",
  sessionsEmpty: "لا توجد جلسات أخرى نشطة.",
  sessionsError: "تعذّر تحميل الجلسات. أعد المحاولة بعد قليل.",
  sessionsRevoked: "تم إنهاء الجلسة.",
};

export const authStrings: Record<CreativeLocale, AuthCopy> = { en, ar };

export function authCopy(locale: CreativeLocale): AuthCopy {
  return authStrings[locale];
}
