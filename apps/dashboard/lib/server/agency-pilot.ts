import "server-only";
import { timingSafeEqual } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { NextRequest } from "next/server";
// Native Node loading preserves immutable on-disk source pins. Turbopack must
// not rewrite the kernel's import.meta.url-relative evidence paths.
const { prepareTask, completeTask, validateCommand, responseHash }: typeof import("@tanaghom/agent-runtime")
  = process.getBuiltinModule("module").createRequire(`${process.cwd()}/package.json`)("@tanaghom/agent-runtime");
import { authorize, AuthorizationError } from "@/lib/server/authorization";
import { AuthenticationError, enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { noStore } from "@/lib/server/responses";

class PilotError extends Error { constructor(public status: number, public code: string) { super(code); } }
declare global { var tanaghomAgencyPilotPool: Pool | undefined; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function enabled() {
  if (process.env.AGENCY_PILOT_GATEWAY_ENABLED !== "true") throw new PilotError(503, "pilot_disabled");
}
function worker(request: NextRequest) {
  enabled();
  const expected = Buffer.from(process.env.AGENCY_PILOT_WORKER_TOKEN || "");
  const actual = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") || "");
  if (expected.length < 32 || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new AuthenticationError("Worker authentication failed");
  }
  if (!process.env.AGENCY_PILOT_DATABASE_URL) throw new PilotError(503, "pilot_database_unavailable");
  return globalThis.tanaghomAgencyPilotPool ??= new Pool({ connectionString: process.env.AGENCY_PILOT_DATABASE_URL,
    max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: "tanaghom-agency-pilot" });
}
async function body(request: NextRequest, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new PilotError(400, "pilot_body_required");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new PilotError(413, "pilot_body_too_large"); }
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new PilotError(400, "pilot_json_invalid"); }
  } finally { reader.releaseLock(); }
}
export function pilotFailure(error: unknown) {
  // Do not log raw SQL, model output, tokens, or submitted evidence.
  const status = error instanceof PilotError ? error.status : error instanceof AuthenticationError ? 401
    : error instanceof AuthorizationError ? 403 : 409;
  return noStore({ error: error instanceof PilotError ? error.code : status === 401 ? "unauthorized"
    : status === 403 ? "forbidden" : "pilot_request_rejected" }, { status });
}
export async function pilotOwner(request: NextRequest) {
  const actor = await authorize(request, ["owner"]);
  enabled();
  if (request.method === "GET") {
    const [bindings, tasks, events] = await Promise.all([
      database().query("SELECT id,agent_version_id,profile_code,created_at FROM tanaghom.agency_pilot_bindings WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50", [actor.organizationId]),
      database().query(`SELECT id,binding_id,language,status,attempt,result,error_code,created_at,finished_at
        FROM tanaghom.agency_pilot_tasks WHERE organization_id=$1 ORDER BY created_at DESC,id LIMIT 50`, [actor.organizationId]),
      database().query("SELECT id,task_id,event_type,reference_id,evidence,occurred_at FROM tanaghom.agency_pilot_events WHERE organization_id=$1 ORDER BY id DESC LIMIT 100", [actor.organizationId]),
    ]);
    return { mode: "simulation", bindings: bindings.rows, tasks: tasks.rows, events: events.rows };
  }
  enforceSameOriginForCookieMutation(request);
  let command;
  try { command = validateCommand(await body(request, 32000)); }
  catch (error) { if (error instanceof PilotError) throw error; throw new PilotError(400, "pilot_command_invalid"); }
  let result;
  switch (command.action) {
    case "bind": result = await database().query("SELECT tanaghom.bind_agency_pilot($1,$2,$3) AS id", [actor.id, command.agent_version_id, command.profile_code]); break;
    case "approve_evidence": result = await database().query("SELECT tanaghom.approve_agency_pilot_evidence($1,$2,$3,$4) AS id", [actor.id, command.kind, command.record, command.expires_at]); break;
    case "revoke_evidence": result = await database().query("SELECT tanaghom.revoke_agency_pilot_evidence($1,$2)", [actor.id, command.evidence_id]); break;
    case "queue": result = await database().query("SELECT tanaghom.queue_agency_pilot($1,$2,$3,$4,$5,$6,$7,$8) AS id",
      [actor.id, command.binding_id, command.model_profile_id, command.language, command.target_id, command.options, command.evidence_ids, command.idempotency_key]); break;
    default: throw new PilotError(400, "pilot_command_invalid");
  }
  return { ...result.rows[0], mode: "simulation", external_action_count: 0 };
}
async function resolved(client: PoolClient, task: string, lease: string) {
  return (await client.query("SELECT tanaghom.resolve_agency_pilot($1,$2) AS bundle", [task, lease])).rows[0].bundle;
}
export async function pilotWorker(request: NextRequest) {
  const pool = worker(request);
  const command = await body(request, 150000);
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new PilotError(400, "pilot_command_invalid");
  const keys = Object.keys(command).sort().join(",");
  const claim = command.action === "claim" && keys === "action";
  const complete = command.action === "complete" && keys === "action,lease_token,model_response,task_id"
    && uuid.test(command.task_id) && uuid.test(command.lease_token);
  if (!claim && !complete) throw new PilotError(400, "pilot_command_invalid");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL statement_timeout='10s'");
    if (claim) {
      const t = (await client.query("SELECT * FROM tanaghom.claim_agency_pilot()")).rows[0];
      if (!t) { await client.query("COMMIT"); return { task: null }; }
      await client.query("SAVEPOINT preparation");
      try {
        const bundle = await resolved(client, t.task_id, t.lease_token);
        const prepared = prepareTask(bundle);
        await client.query("SELECT tanaghom.seal_agency_pilot($1,$2,$3,$4)", [t.task_id, t.lease_token, bundle.basis_hash, prepared]);
        await client.query("COMMIT");
        return { task: { ...t, profile_code: prepared.code, request: prepared.request } };
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT preparation");
        await client.query("SELECT tanaghom.finish_agency_pilot($1,$2,$3,NULL,'pilot_validation_failed')",
          [t.task_id, t.lease_token, responseHash({ error: "pilot_preparation_failed" })]);
        await client.query("COMMIT");
        return { task: null, failed_task_id: t.task_id, error: "pilot_preparation_failed" };
      }
    }
    const hash = responseHash(command.model_response);
    const previous = (await client.query("SELECT tanaghom.read_agency_pilot_completion($1,$2) AS result", [command.task_id, command.lease_token])).rows[0].result;
    if (previous) {
      if (previous.response_hash !== hash) throw new PilotError(409, "pilot_completion_conflict");
      await client.query("COMMIT");
      return { task_id: previous.task_id, status: previous.status, replay: true };
    }
    await client.query("SAVEPOINT completion");
    let result = null, error = null;
    try { result = completeTask(await resolved(client, command.task_id, command.lease_token), command.model_response); }
    catch { await client.query("ROLLBACK TO SAVEPOINT completion"); error = "pilot_validation_failed"; }
    const finished = (await client.query("SELECT tanaghom.finish_agency_pilot($1,$2,$3,$4,$5) AS result",
      [command.task_id, command.lease_token, hash, result, error])).rows[0].result;
    await client.query("COMMIT");
    return finished;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
