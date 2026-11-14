import type { CreativeLocale } from "@/lib/i18n/creative";

export interface AuthEmailCopy {
  forgotEyebrow: string;
  forgotTitle: string;
  forgotLede: string;
  emailLabel: string;
  sendReset: string;
  sendingReset: string;
  resetSent: string;
  forgotError: string;
  resetEyebrow: string;
  resetTitle: string;
  resetLede: string;
  newPassword: string;
  confirmPassword: string;
  passwordHint: string;
  choosePassword: string;
  choosingPassword: string;
  passwordMismatch: string;
  invalidToken: string;
  resetError: string;
  resetSuccess: string;
  verifyEyebrow: string;
  verifyTitle: string;
  verifyLede: string;
  verifying: string;
  verified: string;
  verifiedLede: string;
  verifyError: string;
  resendVerification: string;
  resendingVerification: string;
  verificationSent: string;
  alreadyVerified: string;
  signedOutVerify: string;
  rateLimited: string;
  backToSignIn: string;
  passwordTooWeak: string;
}

const en: AuthEmailCopy = {
  forgotEyebrow: "Account recovery",
  forgotTitle: "Forgot your password?",
  forgotLede: "Enter the email connected to your workspace. If an account exists, we will send a single-use reset link.",
  emailLabel: "Work email",
  sendReset: "Send reset link",
  sendingReset: "Sending…",
  resetSent: "If an account exists for that email, we've sent a password reset link.",
  forgotError: "Tanaghom could not process the request. Please try again in a moment.",
  resetEyebrow: "Choose a new password",
  resetTitle: "Reset your password",
  resetLede: "Use at least 10 characters with upper and lower case letters and a number. Every other session will be signed out.",
  newPassword: "New password",
  confirmPassword: "Confirm new password",
  passwordHint: "At least 10 characters, including upper and lower case letters and a number.",
  choosePassword: "Set new password",
  choosingPassword: "Saving…",
  passwordMismatch: "The passwords do not match.",
  invalidToken: "This reset link is invalid or has expired. Request a new one.",
  resetError: "The password could not be reset. Request a new link and try again.",
  resetSuccess: "Password updated. Sign in with your new password.",
  verifyEyebrow: "Email verification",
  verifyTitle: "Verify your email",
  verifyLede: "Confirm the address connected to your Tanaghom account.",
  verifying: "Verifying your email…",
  verified: "Email verified",
  verifiedLede: "Your address is confirmed. You can return to your workspace.",
  verifyError: "This verification link is invalid or has expired. Request a new one below.",
  resendVerification: "Resend verification email",
  resendingVerification: "Sending…",
  verificationSent: "A fresh verification email is on its way.",
  alreadyVerified: "This email is already verified.",
  signedOutVerify: "Sign in to request another verification email.",
  rateLimited: "Too many requests. Try again later.",
  backToSignIn: "Back to sign in",
  passwordTooWeak: "Use at least 10 characters with upper and lower case letters and a number.",
};

const ar: AuthEmailCopy = {
  forgotEyebrow: "استعادة الحساب",
  forgotTitle: "هل نسيت كلمة المرور؟",
  forgotLede: "أدخل البريد الإلكتروني المرتبط بمساحة عملك. إذا كان الحساب موجودًا فسنرسل رابطًا لمرة واحدة.",
  emailLabel: "البريد الإلكتروني للعمل",
  sendReset: "إرسال رابط الاستعادة",
  sendingReset: "جارٍ الإرسال…",
  resetSent: "إذا كان هناك حساب بهذا البريد، فقد أرسلنا رابطًا لإعادة تعيين كلمة المرور.",
  forgotError: "تعذّر على تناغم تنفيذ الطلب. حاول مرة أخرى بعد قليل.",
  resetEyebrow: "اختر كلمة مرور جديدة",
  resetTitle: "إعادة تعيين كلمة المرور",
  resetLede: "استخدم ١٠ أحرف على الأقل تتضمن حروفًا كبيرة وصغيرة ورقمًا. ستُسجَّل الخروج من كل الجلسات الأخرى.",
  newPassword: "كلمة المرور الجديدة",
  confirmPassword: "تأكيد كلمة المرور الجديدة",
  passwordHint: "١٠ أحرف على الأقل، مع حروف كبيرة وصغيرة ورقم.",
  choosePassword: "تعيين كلمة المرور",
  choosingPassword: "جارٍ الحفظ…",
  passwordMismatch: "كلمتا المرور غير متطابقتين.",
  invalidToken: "رابط إعادة التعيين غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا.",
  resetError: "تعذّرت إعادة تعيين كلمة المرور. اطلب رابطًا جديدًا وحاول مرة أخرى.",
  resetSuccess: "تم تحديث كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.",
  verifyEyebrow: "تأكيد البريد الإلكتروني",
  verifyTitle: "تحقق من بريدك الإلكتروني",
  verifyLede: "أكّد العنوان المرتبط بحسابك في تناغم.",
  verifying: "جارٍ التحقق من بريدك…",
  verified: "تم تأكيد البريد الإلكتروني",
  verifiedLede: "تم تأكيد عنوانك. يمكنك العودة إلى مساحة عملك.",
  verifyError: "رابط التحقق غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا أدناه.",
  resendVerification: "إعادة إرسال رسالة التحقق",
  resendingVerification: "جارٍ الإرسال…",
  verificationSent: "تم إرسال رسالة تحقق جديدة.",
  alreadyVerified: "هذا البريد مؤكد بالفعل.",
  signedOutVerify: "سجّل الدخول لطلب رسالة تحقق أخرى.",
  rateLimited: "طلبات كثيرة جدًا. حاول لاحقًا.",
  backToSignIn: "العودة لتسجيل الدخول",
  passwordTooWeak: "استخدم ١٠ أحرف على الأقل مع حروف كبيرة وصغيرة ورقم.",
};

export function authEmailCopy(locale: CreativeLocale): AuthEmailCopy {
  return locale === "ar" ? ar : en;
}
