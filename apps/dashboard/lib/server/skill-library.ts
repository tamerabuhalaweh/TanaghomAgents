import "server-only";

import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import {
  parseOrganizationSkillDraft,
  portableSkillMarkdown,
  SkillLibraryValidationError,
  validationReport,
} from "@/lib/server/skill-library-validation";

export class SkillLibraryRequestError extends Error {
  constructor(public readonly code: string, public readonly status = 400, public readonly details?: unknown) {
    super(code);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lifecycleActions = new Set(["validate", "publish", "retire"]);

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/owner|required|cross-tenant|unknown|invalid|validation|published|lifecycle|unsafe|unsupported/i.test(message)) {
    return new SkillLibraryRequestError("skill_operation_rejected", 409);
  }
  return error;
}

export async function listSkillLibrary(request: NextRequest) {
  const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
  const search = request.nextUrl.searchParams.get("search")?.trim().slice(0, 100).toLowerCase() || "";
  const [platform, organization, references] = await Promise.all([
    database().query(
      `SELECT definition.id AS skill_id,version.id AS version_id,definition.code,definition.name AS display_name,
         definition.description,definition.skill_class,version.version_number,version.lifecycle_state,
         version.risk_class,version.side_effect_class,version.permission_manifest,
         version.integration_requirements,version.content_hash,version.created_at,
         version.instructions,version.input_schema_ref,version.output_schema_ref,
         COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
           'role_code',binding.role_code,'worker_code',binding.worker_code,'state',binding.binding_state
         )) FILTER (WHERE binding.id IS NOT NULL),'[]'::jsonb) AS assigned_agents
       FROM tanaghom.skill_definitions definition
       JOIN tanaghom.skill_versions version ON version.skill_id=definition.id
       LEFT JOIN tanaghom.agent_skill_bindings binding ON binding.skill_version_id=version.id
       WHERE definition.owner_scope='platform'
         AND ($1='' OR lower(definition.name||' '||definition.description||' '||definition.code) LIKE '%'||$1||'%')
       GROUP BY definition.id,version.id
       ORDER BY definition.name,version.version_number DESC`,
      [search],
    ),
    database().query(
      `SELECT definition.id AS skill_id,version.id AS version_id,definition.code,
         version.display_name,version.description,definition.skill_class,version.version_number,
         version.lifecycle_state,
         CASE WHEN definition.skill_class='knowledge' THEN 'low' ELSE 'medium' END AS risk_class,
         'proposal_only' AS side_effect_class,version.activation_guidance,version.instructions,
         version.examples,version.expected_inputs,version.expected_outputs,version.escalation_conditions,
         version.languages,version.content_hash,version.validation_report,version.validated_at,
         version.published_at,version.retired_at,version.created_at,
         creator.display_name AS created_by_name,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'event_type',audit.event_type,'occurred_at',audit.occurred_at,'actor_name',actor.display_name
         ) ORDER BY audit.occurred_at DESC)
         FROM tanaghom.organization_skill_audit_events audit
         JOIN tanaghom.app_users actor ON actor.id=audit.actor_id
         WHERE audit.skill_version_id=version.id),'[]'::jsonb) AS audit_events,
         '[]'::jsonb AS assigned_agents
       FROM tanaghom.organization_skill_definitions definition
       JOIN tanaghom.organization_skill_versions version ON version.skill_id=definition.id
       JOIN tanaghom.app_users creator ON creator.id=version.created_by
       WHERE definition.organization_id=$1
         AND ($2='' OR lower(version.display_name||' '||version.description||' '||definition.code) LIKE '%'||$2||'%')
         AND ($3::boolean OR version.lifecycle_state IN ('published','superseded','retired'))
       ORDER BY version.display_name,version.version_number DESC`,
      [user.organizationId, search, user.role === "owner"],
    ),
    database().query(
      `SELECT reference.* FROM tanaghom.organization_skill_references reference
       WHERE reference.organization_id=$1 ORDER BY reference.title`,
      [user.organizationId],
    ),
  ]);
  const organizationRows = organization.rows as Array<Record<string, unknown>>;
  const referenceRows = references.rows as Array<Record<string, unknown>>;
  return {
    can_manage: user.role === "owner",
    platform_skills: platform.rows,
    organization_skills: organizationRows.map((version) => ({
      ...version,
      references: referenceRows.filter((reference) => reference.skill_version_id === version.version_id),
    })),
    counts: {
      platform: platform.rowCount,
      organization: new Set(organizationRows.map((row) => row.skill_id)).size,
      drafts: organizationRows.filter((row) => row.lifecycle_state === "draft").length,
      published: organizationRows.filter((row) => row.lifecycle_state === "published").length,
    },
    safety: {
      customer_classes: ["knowledge", "proposal_instruction"],
      executable_customer_skills: false,
      agent_bindings_changed_by_publish: false,
      allowed_languages: ["en", "ar"],
    },
  };
}

export async function createSkillDraft(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  let input;
  try {
    input = parseOrganizationSkillDraft(await request.json());
  } catch (error) {
    if (error instanceof SkillLibraryValidationError) {
      throw new SkillLibraryRequestError("skill_validation_failed", error.status, error.issues);
    }
    throw error;
  }
  try {
    const result = await database().query(
      `SELECT * FROM tanaghom.create_organization_skill_draft(
        $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::text[],$11::text[],$12,$13::text[],
        $14,$15::jsonb,$16::uuid
      )`,
      [
        owner.organizationId, owner.id, input.code, input.skill_class, input.display_name,
        input.description, input.activation_guidance, input.instructions, JSON.stringify(input.examples),
        input.expected_inputs, input.expected_outputs, input.escalation_conditions, input.languages,
        input.content_hash, JSON.stringify(input.references), input.clone_source_version_id,
      ],
    );
    return { ...result.rows[0], content_hash: input.content_hash };
  } catch (error) {
    throw databaseError(error);
  }
}

export async function transitionSkillVersion(request: NextRequest, versionId: string) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  if (!uuidPattern.test(versionId)) throw new SkillLibraryRequestError("skill_version_invalid");
  const body = await request.json() as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  if (!lifecycleActions.has(action)) throw new SkillLibraryRequestError("skill_action_invalid");
  let report: Record<string, unknown> | null = null;
  if (action === "validate") {
    const source = await database().query(
      `SELECT definition.code,definition.skill_class,version.display_name,version.description,
         version.activation_guidance,version.instructions,version.examples,version.expected_inputs,
         version.expected_outputs,version.escalation_conditions,version.languages,version.content_hash,
         COALESCE(jsonb_agg(jsonb_build_object(
           'reference_type',reference.reference_type,'reference_key',reference.reference_key,
           'title',reference.title,'language',reference.language,'provenance',reference.provenance,
           'expires_at',reference.expires_at
         )) FILTER (WHERE reference.id IS NOT NULL),'[]'::jsonb) AS references
       FROM tanaghom.organization_skill_versions version
       JOIN tanaghom.organization_skill_definitions definition ON definition.id=version.skill_id
       LEFT JOIN tanaghom.organization_skill_references reference ON reference.skill_version_id=version.id
       WHERE version.id=$1 AND version.organization_id=$2
       GROUP BY definition.id,version.id`,
      [versionId, owner.organizationId],
    );
    if (!source.rows[0]) throw new SkillLibraryRequestError("skill_version_not_found", 404);
    const checked = parseOrganizationSkillDraft(source.rows[0]);
    if (checked.content_hash !== source.rows[0].content_hash) {
      throw new SkillLibraryRequestError("skill_content_hash_mismatch", 409);
    }
    report = validationReport(checked);
  }
  try {
    const result = await database().query(
      "SELECT * FROM tanaghom.transition_organization_skill_version($1,$2,$3,$4,$5::jsonb)",
      [owner.organizationId, owner.id, versionId, action, report ? JSON.stringify(report) : null],
    );
    return result.rows[0];
  } catch (error) {
    throw databaseError(error);
  }
}

export async function exportSkillVersion(request: NextRequest, versionId: string) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  if (!uuidPattern.test(versionId)) throw new SkillLibraryRequestError("skill_version_invalid");
  const result = await database().query(
    `SELECT definition.code,definition.skill_class,version.display_name,version.description,
       version.activation_guidance,version.instructions,version.examples,version.expected_inputs,
       version.expected_outputs,version.escalation_conditions,version.languages,version.content_hash,
       version.version_number
     FROM tanaghom.organization_skill_versions version
     JOIN tanaghom.organization_skill_definitions definition ON definition.id=version.skill_id
     WHERE version.id=$1 AND version.organization_id=$2`,
    [versionId, owner.organizationId],
  );
  const version = result.rows[0];
  if (!version) throw new SkillLibraryRequestError("skill_version_not_found", 404);
  await database().query(
    "SELECT tanaghom.record_organization_skill_export($1,$2,$3)",
    [owner.organizationId, owner.id, versionId],
  );
  return {
    filename: `${String(version.code).replaceAll("_", "-")}-v${version.version_number}-SKILL.md`,
    content: portableSkillMarkdown(version),
  };
}
