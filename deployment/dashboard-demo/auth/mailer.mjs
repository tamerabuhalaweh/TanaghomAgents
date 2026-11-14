import { existsSync, readFileSync } from "node:fs";

const DEFAULT_BASE_URL = "http://127.0.0.1:3210";
const DEFAULT_API_KEY_FILE = "/run/secrets/auth_email_api_key";
const SEND_TIMEOUT_MS = 8_000;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalFile(path) {
  if (!path || !existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function baseUrl(env) {
  const configured = clean(env.APP_BASE_URL).replace(/\/+$/, "");
  if (!configured) return DEFAULT_BASE_URL;
  try {
    const parsed = new URL(configured);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return DEFAULT_BASE_URL;
    }
    return configured;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function escaped(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkFor(env, path, token) {
  const url = new URL(path, `${baseUrl(env)}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

const DESCRIPTIONS = {
  verify_email: {
    subject: "Verify your Tanaghom email / تحقق من بريدك في تناغم",
    heading: "Verify your email",
    lede: "Confirm this address to finish securing your Tanaghom workspace.",
    action: "Verify email",
    arabic: "أكد بريدك الإلكتروني لإكمال تأمين مساحة عملك في تناغم.",
    ignore: "If you did not create a Tanaghom account, you can ignore this message.",
  },
  reset_password: {
    subject: "Reset your Tanaghom password / إعادة تعيين كلمة المرور",
    heading: "Reset your password",
    lede: "Use this single-use link to choose a new password. It expires in one hour.",
    action: "Choose a new password",
    arabic: "استخدم هذا الرابط لمرة واحدة لاختيار كلمة مرور جديدة. تنتهي صلاحيته بعد ساعة.",
    ignore: "If you did not request a reset, no action is required and your password stays unchanged.",
  },
  invite: {
    subject: "You are invited to Tanaghom / دعوة للانضمام إلى تناغم",
    heading: "Join your Tanaghom workspace",
    lede: "Set your password to accept the invitation your workspace admin sent.",
    action: "Accept invitation",
    arabic: "عيّن كلمة المرور لقبول الدعوة التي أرسلها مسؤول مساحة العمل.",
    ignore: "If you were not expecting this invitation, you can ignore this message.",
  },
};

export function authEmailConfig(env = process.env) {
  const requested = clean(env.AUTH_EMAIL_PROVIDER).toLowerCase();
  const apiKey = clean(env.AUTH_EMAIL_API_KEY)
    || optionalFile(clean(env.AUTH_EMAIL_API_KEY_FILE) || DEFAULT_API_KEY_FILE);
  const webhookUrl = clean(env.AUTH_EMAIL_WEBHOOK_URL);
  const webhookToken = clean(env.AUTH_EMAIL_WEBHOOK_TOKEN)
    || optionalFile(clean(env.AUTH_EMAIL_WEBHOOK_TOKEN_FILE));
  const from = clean(env.AUTH_EMAIL_FROM);
  let mode = "disabled";
  let reason = "provider_not_configured";
  if (requested === "resend" && apiKey && from) {
    mode = "resend";
    reason = "";
  } else if (requested === "resend" && apiKey && !from) {
    reason = "sender_not_configured";
  } else if (requested === "webhook" && webhookUrl) {
    mode = "webhook";
    reason = "";
  }
  return {
    mode,
    reason,
    apiKey,
    webhookUrl,
    webhookToken,
    from,
    baseUrl: baseUrl(env),
    tokenTtlMs: {
      verify_email: 24 * 60 * 60 * 1000,
      reset_password: 60 * 60 * 1000,
      invite: 7 * 24 * 60 * 60 * 1000,
    },
  };
}

export function renderAuthEmail({ purpose, token, env = process.env }) {
  const description = DESCRIPTIONS[purpose];
  if (!description) throw new Error("unsupported auth email purpose");
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    throw new Error("invalid auth token for email");
  }
  const path = purpose === "verify_email"
    ? "/verify-email"
    : purpose === "invite"
      ? "/accept-invite"
      : "/reset-password";
  const url = linkFor(env, path, token);
  const safeUrl = escaped(url);
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f7f6;color:#172522;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe5e1;border-radius:14px;overflow:hidden">
          <tr><td style="padding:26px 30px;background:#114f45;color:#ffffff;font-size:19px;font-weight:700">Tanaghom</td></tr>
          <tr><td style="padding:32px 30px">
            <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2">${description.heading}</h1>
            <p style="margin:0 0 22px;color:#52645f;font-size:15px;line-height:1.6">${description.lede}</p>
            <p style="margin:0 0 22px"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#114f45;color:#ffffff;text-decoration:none;font-weight:700">${description.action}</a></p>
            <p style="margin:0 0 8px;color:#52645f;font-size:12px;line-height:1.6">If the button does not work, open this single-use link:</p>
            <p style="margin:0 0 24px;word-break:break-all;font-size:12px;line-height:1.6"><a href="${safeUrl}" style="color:#114f45">${safeUrl}</a></p>
            <p lang="ar" dir="rtl" style="margin:0 0 20px;padding-top:18px;border-top:1px solid #dbe5e1;color:#52645f;font-size:14px;line-height:1.7">${description.arabic}</p>
            <p style="margin:0;color:#71817d;font-size:12px;line-height:1.6">${description.ignore}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  const text = [
    "Tanaghom",
    "",
    description.heading,
    description.lede,
    "",
    `${description.action}: ${url}`,
    "",
    description.arabic,
    "",
    description.ignore,
  ].join("\n");
  return { subject: description.subject, html, text, url };
}

export function createMailer({ env = process.env, fetchImpl = fetch, logger = console } = {}) {
  const config = authEmailConfig(env);

  function noteSkipped(purpose, to) {
    logger.log(JSON.stringify({
      event: "auth_email_skipped",
      purpose,
      to,
      reason: config.reason || "provider_not_configured",
    }));
  }

  async function deliver({ purpose, to, subject, html, text }) {
    if (config.mode === "disabled") {
      noteSkipped(purpose, to);
      return "skipped_unconfigured";
    }
    try {
      const response = config.mode === "resend"
        ? await fetchImpl("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ from: config.from, to: [to], subject, html, text }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          })
        : await fetchImpl(config.webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(config.webhookToken ? { Authorization: `Bearer ${config.webhookToken}` } : {}),
            },
            body: JSON.stringify({ event: "auth_email", purpose, to, subject, html, text }),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          });
      if (!response.ok) {
        logger.error(JSON.stringify({
          event: "auth_email_failed",
          purpose,
          to,
          provider: config.mode,
          status: response.status,
        }));
        return "failed";
      }
      return "sent";
    } catch {
      // Never log the token-bearing link or provider response body.
      logger.error(JSON.stringify({
        event: "auth_email_failed",
        purpose,
        to,
        provider: config.mode,
        reason: "transport_error",
      }));
      return "failed";
    }
  }

  async function send(purpose, to, token) {
    if (typeof to !== "string" || !to.includes("@")) return "failed";
    const rendered = renderAuthEmail({ purpose, token, env });
    return deliver({ purpose, to, ...rendered });
  }

  return {
    mode: config.mode,
    get configured() {
      return config.mode !== "disabled";
    },
    reason: config.reason,
    sendVerifyEmail({ to, token }) {
      return send("verify_email", to, token);
    },
    sendResetEmail({ to, token }) {
      return send("reset_password", to, token);
    },
    sendInviteEmail({ to, token }) {
      return send("invite", to, token);
    },
  };
}
