"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

import { authenticatedFetch } from "@/lib/client/authenticated-fetch";
import { useLocale } from "@/lib/client/use-locale";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_current_password: "That current password is not correct.",
  current_and_new_password_required: "Enter your current password and a new one.",
  password_too_short: "Use at least 12 characters.",
  password_too_long: "Use no more than 128 characters.",
  password_too_simple: "Use a password with more distinct characters.",
  password_too_common: "That password is too common. Choose a different one.",
  password_contains_email: "Do not reuse your email address inside the password.",
  password_reused: "The new password must differ from the current one.",
  session_expired: "Your session ended. Sign in again and retry.",
  too_many_attempts: "Too many attempts. Wait a few minutes and retry.",
};

export function SecuritySettings() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "working" | "done">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmation) {
      setError("The new password and its confirmation do not match.");
      return;
    }
    setState("working");
    try {
      const response = await authenticatedFetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setState("idle");
        setError(ERROR_MESSAGES[body.error ?? ""] ?? "The password could not be changed. Try again.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setState("done");
      window.setTimeout(() => window.location.assign("/login"), 2_500);
    } catch {
      setState("idle");
      setError("The password could not be changed. Check your connection and retry.");
    }
  }

  return (
    <div className="page-stack" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <header className="page-heading">
        <div>
          <p className="eyebrow">{ar ? "أمان الحساب" : "Account security"}</p>
          <h1>{ar ? "كلمة المرور" : "Password"}</h1>
          <p>{ar ? "تغيير كلمة المرور يسجّل خروج كل الجلسات الأخرى لهذا الحساب." : "Changing your password signs out every other session for this account."}</p>
        </div>
      </header>

      {state === "done" ? (
        <section className="operations-state" role="status" aria-live="polite">
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <h2>{ar ? "تم تغيير كلمة المرور" : "Password changed"}</h2>
            <p>{ar ? "سيتم تسجيل خروجك لاستخدام كلمة المرور الجديدة في كل مكان. ستعود إلى صفحة تسجيل الدخول." : "Signing you out so the new password is used everywhere. You will return to the sign-in page."}</p>
          </div>
        </section>
      ) : (
        <section className="panel">
          <form className="login-form" method="post" onSubmit={submit}>
            <div className="form-field">
              <label htmlFor="current-password">{ar ? "كلمة المرور الحالية" : "Current password"}</label>
              <input
                id="current-password"
                name="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-password">{ar ? "كلمة المرور الجديدة" : "New password"}</label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <small>{ar ? "١٢ حرفاً على الأقل. لا تعد استخدام بريدك الإلكتروني أو عبارة شائعة." : "At least 12 characters. Do not reuse your email address or a common phrase."}</small>
            </div>
            <div className="form-field">
              <label htmlFor="confirm-password">{ar ? "تأكيد كلمة المرور الجديدة" : "Confirm new password"}</label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            <p className="login-error" role="alert" aria-live="polite">{error}</p>
            <button className="primary-button" type="submit" disabled={state === "working"}>
              <KeyRound size={16} aria-hidden="true" />
              {state === "working" ? (ar ? "جارٍ تغيير كلمة المرور…" : "Changing password…") : (ar ? "تغيير كلمة المرور" : "Change password")}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
