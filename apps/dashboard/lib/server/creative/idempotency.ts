import "server-only";

import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";

export class IdempotencyRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export function idempotencyKey(request: NextRequest) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new IdempotencyRequestError("valid_idempotency_key_required", 400);
  }
  return key;
}

interface Replay {
  replayed: true;
  response_status: number;
  response_body: unknown;
}

interface Reserved {
  replayed: false;
  reservation_id: string;
}

// Reserves an idempotency slot inside the caller's transaction. Returns the
// cached response when this exact request already completed, throws
// idempotency_key_reused on conflicting reuse, or a reservation to complete.
export async function reserveIdempotency(
  client: PoolClient,
  actorUserId: string,
  operationType: string,
  key: string,
  requestHash: string,
): Promise<Replay | Reserved> {
  const reservation = await client.query<{ id: string }>(
    `INSERT INTO tanaghom.api_idempotency_keys (
       actor_user_id, operation_type, idempotency_key, request_hash
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (actor_user_id, operation_type, idempotency_key) DO NOTHING
     RETURNING id`,
    [actorUserId, operationType, key, requestHash],
  );
  if (reservation.rows[0]) {
    return { replayed: false, reservation_id: reservation.rows[0].id };
  }
  const existing = await client.query<{
    request_hash: string;
    status: string;
    response_status: number | null;
    response_body: unknown;
  }>(
    `SELECT request_hash, status, response_status, response_body
       FROM tanaghom.api_idempotency_keys
      WHERE actor_user_id = $1 AND operation_type = $2 AND idempotency_key = $3`,
    [actorUserId, operationType, key],
  );
  const replay = existing.rows[0];
  if (!replay || replay.request_hash !== requestHash) {
    throw new IdempotencyRequestError("idempotency_key_reused", 409);
  }
  if (replay.status !== "completed" || !replay.response_status || !replay.response_body) {
    throw new IdempotencyRequestError("request_in_progress", 409);
  }
  return { replayed: true, response_status: replay.response_status, response_body: replay.response_body };
}

export async function completeIdempotency(
  client: PoolClient,
  reservationId: string,
  status: number,
  body: unknown,
) {
  await client.query(
    `UPDATE tanaghom.api_idempotency_keys
        SET status = 'completed', response_status = $2,
            response_body = $3::jsonb, completed_at = now()
      WHERE id = $1`,
    [reservationId, status, JSON.stringify(body)],
  );
}
