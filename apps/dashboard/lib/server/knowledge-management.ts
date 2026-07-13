import "server-only";

import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";

const categories = new Set([
  "product", "service", "pricing", "faq", "policy", "offer", "objection",
  "qualification", "location", "hours", "escalation_rule", "disclaimer",
  "dialect_example",
]);
const languages = new Set(["en", "ar", "und"]);
const provenanceTypes = new Set([
  "customer_document", "customer_entry", "approved_url", "legal_policy", "operator_note",
]);
const actions = new Set(["review", "approve", "activate", "revoke", "rollback"]);

export class KnowledgeRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

function string(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum + 1) : "";
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/owner|required|knowledge|transition|revok|rollback|invalid/i.test(message)) {
    return new KnowledgeRequestError("knowledge_transition_rejected", 409);
  }
  return error;
}

export async function listKnowledge(request: NextRequest) {
  const owner = await authorize(request, ["owner"]);
  const [versions, policy, proposalStats] = await Promise.all([
    database().query(
      `SELECT source.id AS source_id, source.source_key, source.title, source.category,
         source.provenance_type, source.provenance_ref,
         version.id AS version_id, version.version_number, version.status, version.language,
         version.content, version.structured_facts, version.content_fingerprint,
         version.created_at, version.reviewed_at, version.approved_at,
         version.activated_at, version.superseded_at, version.revoked_at,
         version.revoked_reason, creator.display_name AS created_by_name
       FROM tanaghom.sales_knowledge_sources source
       JOIN tanaghom.sales_knowledge_versions version ON version.source_id=source.id
       JOIN tanaghom.app_users creator ON creator.id=version.created_by
       WHERE source.organization_id=$1
       ORDER BY source.title, version.version_number DESC`,
      [owner.organizationId],
    ),
    database().query(
      `SELECT version_number, confidence_threshold, supported_languages,
         mandatory_escalations, forbidden_topics, forbidden_claims, sensitive_data_rules,
         prompt_version, activated_at
       FROM tanaghom.organization_conversation_policy_versions
       WHERE organization_id=$1 AND status='active'`,
      [owner.organizationId],
    ),
    database().query(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE escalation_required)::int AS escalated,
         count(*) FILTER (WHERE answer_status='no_approved_answer')::int AS ungrounded
       FROM tanaghom.conversation_intelligence_proposals WHERE organization_id=$1`,
      [owner.organizationId],
    ),
  ]);
  const rows = versions.rows as Array<Record<string, unknown>>;
  return {
    versions: rows,
    policy: policy.rows[0] || null,
    proposal_stats: proposalStats.rows[0] || { total: 0, escalated: 0, ungrounded: 0 },
    counts: {
      sources: new Set(rows.map((row) => row.source_id)).size,
      active: rows.filter((row) => row.status === "active").length,
      awaiting_review: rows.filter((row) => row.status === "draft" || row.status === "reviewed").length,
      revoked: rows.filter((row) => row.status === "revoked").length,
    },
  };
}

export async function createKnowledgeDraft(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  const body = await request.json() as Record<string, unknown>;
  const sourceKey = string(body.source_key, 80);
  const title = string(body.title, 200);
  const category = string(body.category, 40);
  const language = string(body.language, 3);
  const content = string(body.content, 30000);
  const provenanceType = string(body.provenance_type, 40);
  const provenanceRef = string(body.provenance_ref, 1000);
  const structuredFacts = Array.isArray(body.structured_facts) ? body.structured_facts : [];
  if (!/^[a-z][a-z0-9_-]{2,79}$/.test(sourceKey) || title.length < 3
    || !categories.has(category) || !languages.has(language) || content.length < 3
    || !provenanceTypes.has(provenanceType) || structuredFacts.length > 100) {
    throw new KnowledgeRequestError("knowledge_draft_invalid");
  }
  try {
    const result = await database().query(
      `SELECT * FROM tanaghom.create_sales_knowledge_draft(
        $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9
      )`,
      [sourceKey, title, category, language, content, JSON.stringify(structuredFacts),
        provenanceType, provenanceRef || null, owner.id],
    );
    return result.rows[0];
  } catch (error) { throw databaseError(error); }
}

export async function transitionKnowledge(request: NextRequest, versionId: string) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) throw new KnowledgeRequestError("knowledge_version_invalid");
  const body = await request.json() as Record<string, unknown>;
  const action = string(body.action, 20);
  const reason = string(body.reason, 1000);
  if (!actions.has(action) || (action === "revoke" && reason.length < 3)) {
    throw new KnowledgeRequestError("knowledge_transition_invalid");
  }
  try {
    const result = await database().query(
      "SELECT * FROM tanaghom.transition_sales_knowledge_version($1,$2,$3,$4)",
      [versionId, action, owner.id, reason || null],
    );
    return result.rows[0];
  } catch (error) { throw databaseError(error); }
}
