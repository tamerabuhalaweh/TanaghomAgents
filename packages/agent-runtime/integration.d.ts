export type PilotCommand =
  | { action: "bind"; agent_version_id: string; profile_code: string }
  | { action: "approve_evidence"; kind: string; record: Record<string, unknown>; expires_at: string }
  | { action: "revoke_evidence"; evidence_id: string }
  | { action: "queue"; binding_id: string; model_profile_id: string; language: "en" | "ar";
      target_id: string | null; options: Record<string, unknown>; evidence_ids: string[]; idempotency_key: string };
export interface PreparedPilotTask {
  code: string;
  execution: unknown;
  request: Record<string, unknown> | null;
}
// Bundle is an internal SQL-resolver result, never an HTTP request payload.
export function prepareTask(bundle: unknown): PreparedPilotTask;
export function completeTask(bundle: unknown, body: unknown): Record<string, unknown>;
export function validateEvidence(kind: string, record: unknown): void;
export function validateCommand(body: unknown): PilotCommand;
export function responseHash(body: unknown): string;
