export interface DeliveryOutcome { sent: boolean; status: number | null; error: string | null; retryable: boolean }
export type DeliveryTransport = (target: string, message: { subject: string; text: string }) => Promise<DeliveryOutcome>;
export interface ClaimedDelivery {
  delivery_id: string; channel: string; event_type: string; severity: string; attempts: number; organization_name: string;
  target_ciphertext: Buffer; target_nonce: Buffer; target_auth_tag: Buffer; target_key_version: number;
}
export function alertMessage(row: Pick<ClaimedDelivery, "event_type" | "severity" | "organization_name">): { subject: string; text: string };
export function slackTransport(options: { fetch: typeof fetch; rewriteOrigin?: ((target: string) => string) | null }): DeliveryTransport;
export function emailTransport(options: { transporter: { sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> }; from: string }): DeliveryTransport;
export function runDeliveryTick(options: {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: any[] }>;
  decrypt: (row: ClaimedDelivery) => string;
  transports: Partial<Record<string, DeliveryTransport>>;
  limit?: number;
}): Promise<{ enqueued: number; claimed: number; results: { delivery_id: string; channel: string; event_type: string; state: string; error: string | null }[] }>;
export function smtpTransporter(url: string, options?: { connect?: (() => import("node:net").Socket) | null; timeoutMs?: number }): { sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
