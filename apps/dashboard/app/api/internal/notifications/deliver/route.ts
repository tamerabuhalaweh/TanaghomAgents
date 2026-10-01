import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { database } from "@/lib/server/database";
import { decryptCredential } from "@/lib/server/integration-crypto";
import { noStore } from "@/lib/server/responses";

export const runtime = "nodejs";

const { runDeliveryTick, slackTransport, emailTransport, smtpTransporter }: typeof import("@tanaghom/agent-runtime/notification-delivery")
  = process.getBuiltinModule("module").createRequire(`${process.cwd()}/package.json`)("@tanaghom/agent-runtime/notification-delivery");

function workerAuthorized(request: NextRequest) {
  const configured = process.env.NOTIFICATION_WORKER_TOKEN || "";
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (configured.length < 32 || supplied.length !== configured.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
}

const emailUnavailable = async () => ({ sent: false, status: null, error: "email_runtime_not_configured", retryable: false });

// One bounded delivery tick. Off by default: requires this flag AND the database control.
export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return noStore({ error: "worker_authentication_required" }, { status: 401 });
  if (process.env.NOTIFICATION_DELIVERY_ENABLED !== "true") {
    return noStore({ error: "notification_delivery_disabled" }, { status: 503 });
  }
  const smtpUrl = process.env.NOTIFICATION_SMTP_URL;
  const from = process.env.NOTIFICATION_EMAIL_FROM;
  try {
    const result = await runDeliveryTick({
      query: (sql, args) => database().query(sql, args),
      decrypt: (row) => decryptCredential({
        credential_ciphertext: row.target_ciphertext,
        credential_nonce: row.target_nonce,
        credential_auth_tag: row.target_auth_tag,
        credential_key_version: row.target_key_version,
      }),
      transports: {
        slack: slackTransport({ fetch }),
        email: smtpUrl?.startsWith("smtps://") && from
          ? emailTransport({ transporter: smtpTransporter(smtpUrl), from })
          : emailUnavailable,
      },
    });
    return noStore(result);
  } catch {
    return noStore({ error: "notification_delivery_unavailable" }, { status: 503 });
  }
}
