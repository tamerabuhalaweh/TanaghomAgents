import "server-only";

import type { NextRequest } from "next/server";

import { enforceSameOriginForCookieMutation } from "@/lib/server/auth";
import { authorize } from "@/lib/server/authorization";
import { database } from "@/lib/server/database";
import {
  agentValidationReport,
  AgentStudioValidationError,
  parseOrganizationAgentDraft,
} from "@/lib/server/agent-studio-validation";

export class AgentStudioRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(code);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lifecycleActions = new Set(["validate", "pause", "resume", "retire"]);

function mappedDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/stale organization agent source version/i.test(message)) {
    return new AgentStudioRequestError("agent_version_stale", 409);
  }
  if (/knowledge version/i.test(message)) {
    return new AgentStudioRequestError("agent_knowledge_not_available", 409);
  }
  if (/integration|provider|channel|combination/i.test(message)) {
    return new AgentStudioRequestError("agent_integration_not_ready", 409);
  }
  if (/owner|required|cross-tenant|unknown|invalid|validation|published|lifecycle|unsafe|unsupported|certif|integration|binding|mode|immutable/i.test(message)) {
    return new AgentStudioRequestError("agent_operation_rejected", 409);
  }
  return error;
}

function changedFields(current: Record<string, unknown>, previous: Record<string, unknown> | undefined) {
  if (!previous) return ["Initial version"];
  const fields = [
    "display_name", "description", "objective", "responsibility", "tone", "brand_profile_key",
    "languages", "knowledge_keys", "skills", "integrations", "policy",
  ];
  return fields.filter((field) => JSON.stringify(current[field]) !== JSON.stringify(previous[field]));
}

export async function listAgentStudio(request: NextRequest) {
  const user = await authorize(request, ["owner", "reviewer", "operator", "viewer"]);
  const [
    templates,
    platformSkills,
    organizationSkills,
    availableKnowledge,
    connections,
    versions,
    skillBindings,
    integrationBindings,
    policies,
    scenarios,
    audits,
    runtimeProfiles,
    runtimeControls,
    runtimeActivity,
    runtimeCertifications,
  ] = await Promise.all([
    database().query(
      `SELECT code,name,description,responsibility,objective,recommended_skill_codes,maximum_mode
         FROM tanaghom.agent_studio_templates
        WHERE lifecycle_state='published' ORDER BY name`,
    ),
    database().query(
      `SELECT definition.code,definition.name,definition.description,definition.skill_class,
         version.id AS skill_version_id,version.version_number,version.risk_class,
         version.side_effect_class,version.permission_manifest,version.integration_requirements
       FROM tanaghom.skill_definitions definition
       JOIN tanaghom.skill_versions version ON version.skill_id=definition.id
       WHERE definition.owner_scope='platform' AND version.lifecycle_state='published'
       ORDER BY definition.name`,
    ),
    database().query(
      `SELECT definition.code,version.display_name AS name,version.description,
         definition.skill_class,version.id AS skill_version_id,version.version_number,
         CASE WHEN definition.skill_class='knowledge' THEN 'low' ELSE 'medium' END AS risk_class,
         'proposal_only' AS side_effect_class,'{}'::jsonb AS permission_manifest,
         '{}'::text[] AS integration_requirements
       FROM tanaghom.organization_skill_definitions definition
       JOIN tanaghom.organization_skill_versions version ON version.skill_id=definition.id
       WHERE definition.organization_id=$1 AND version.lifecycle_state='published'
       ORDER BY version.display_name`,
      [user.organizationId],
    ),
    database().query(
      `SELECT source.title,source.category,version.language,version.version_number,
         format('knowledge/%s/v%s',source.source_key,version.version_number) AS knowledge_key
       FROM tanaghom.sales_knowledge_sources source
       JOIN tanaghom.sales_knowledge_versions version ON version.source_id=source.id
       WHERE source.organization_id=$1 AND version.status='active'
       ORDER BY source.title,version.language`,
      [user.organizationId],
    ),
    database().query(
      `SELECT id AS connection_id,provider,status,last_tested_at,last_test_status
       FROM tanaghom.integration_connection_status
       WHERE organization_id=$1 AND status<>'disconnected'
       ORDER BY provider`,
      [user.organizationId],
    ),
    database().query(
      `SELECT definition.id AS agent_id,definition.code,version.id AS agent_version_id,
         version.version_number,version.lifecycle_state,version.paused_from_state,
         version.template_code,version.display_name,version.description,version.objective,
         version.responsibility,version.tone,version.brand_profile_key,
         version.languages,version.knowledge_keys,
         version.content_hash,version.validation_report,version.supersedes_version_id,
         version.created_at,version.validated_at,version.activated_at,version.paused_at,
         version.retired_at,creator.display_name AS created_by_name
       FROM tanaghom.organization_agent_definitions definition
       JOIN tanaghom.organization_agent_versions version ON version.agent_id=definition.id
       JOIN tanaghom.app_users creator ON creator.id=version.created_by
       WHERE definition.organization_id=$1
         AND ($2::boolean OR version.lifecycle_state<>'draft')
       ORDER BY definition.code,version.version_number DESC`,
      [user.organizationId, user.role === "owner"],
    ),
    database().query(
      `SELECT binding.*,COALESCE(platform_definition.code,organization_definition.code) AS skill_code,
         COALESCE(platform_definition.name,organization_version.display_name) AS skill_name,
         COALESCE(platform_version.risk_class,
           CASE WHEN organization_definition.skill_class='knowledge' THEN 'low' ELSE 'medium' END) AS risk_class,
         COALESCE(platform_version.side_effect_class,'proposal_only') AS side_effect_class
       FROM tanaghom.organization_agent_skill_bindings binding
       LEFT JOIN tanaghom.skill_versions platform_version
         ON platform_version.id=binding.platform_skill_version_id
       LEFT JOIN tanaghom.skill_definitions platform_definition
         ON platform_definition.id=platform_version.skill_id
       LEFT JOIN tanaghom.organization_skill_versions organization_version
         ON organization_version.id=binding.organization_skill_version_id
       LEFT JOIN tanaghom.organization_skill_definitions organization_definition
         ON organization_definition.id=organization_version.skill_id
       WHERE binding.organization_id=$1 ORDER BY skill_name`,
      [user.organizationId],
    ),
    database().query(
      `SELECT binding.*,connection.status,connection.last_test_status
       FROM tanaghom.organization_agent_integration_bindings binding
       JOIN tanaghom.integration_connection_status connection
         ON connection.id=binding.connection_id
       WHERE binding.organization_id=$1 ORDER BY binding.provider`,
      [user.organizationId],
    ),
    database().query(
      `SELECT * FROM tanaghom.organization_agent_policies
       WHERE organization_id=$1`,
      [user.organizationId],
    ),
    database().query(
      `SELECT scenario.id,scenario.agent_version_id,scenario.code,scenario.language,
         scenario.scenario_kind,scenario.expected_behavior,
         CASE
           WHEN latest.status='succeeded' AND latest.scenario_result='passed' THEN 'passed'
           WHEN latest.status IN ('failed','refused','cancelled','indeterminate')
             OR latest.scenario_result='failed' THEN 'failed'
           ELSE 'pending'
         END AS result_state,
         latest.id AS job_id,latest.status AS job_status,
         latest.scenario_result,latest.finished_at
       FROM tanaghom.organization_agent_test_scenarios scenario
       LEFT JOIN LATERAL (
         SELECT candidate.id,candidate.status,candidate.scenario_result,
           candidate.finished_at,candidate.created_at
         FROM tanaghom.organization_agent_jobs candidate
         WHERE candidate.organization_id=scenario.organization_id
           AND candidate.agent_version_id=scenario.agent_version_id
           AND candidate.scenario_id=scenario.id
         ORDER BY
           (candidate.status='succeeded' AND candidate.scenario_result='passed') DESC,
           candidate.created_at DESC,candidate.id
         LIMIT 1
       ) latest ON true
       WHERE scenario.organization_id=$1
       ORDER BY scenario.language,scenario.scenario_kind`,
      [user.organizationId],
    ),
    database().query(
      `SELECT audit.agent_id,audit.agent_version_id,audit.event_type,audit.provenance,
         audit.occurred_at,actor.display_name AS actor_name
       FROM tanaghom.organization_agent_audit_events audit
       JOIN tanaghom.app_users actor ON actor.id=audit.actor_id
       WHERE audit.organization_id=$1 ORDER BY audit.occurred_at DESC`,
      [user.organizationId],
    ),
    database().query(
      `SELECT id,code,model_name,planner_contract_version,prompt_version,
         parser_version,lifecycle_state
       FROM tanaghom.agent_runtime_profiles
       WHERE lifecycle_state='validated'
       ORDER BY created_at DESC,id
       LIMIT 1`,
    ),
    database().query(
      `SELECT emergency_stop,reason,max_global_concurrency,updated_at
       FROM tanaghom.agent_runtime_controls
       WHERE singleton`,
    ),
    database().query(
      `SELECT version.id AS agent_version_id,
         (SELECT count(*)::integer
            FROM tanaghom.organization_agent_jobs job
           WHERE job.organization_id=version.organization_id
             AND job.agent_version_id=version.id) AS jobs_total,
         (SELECT count(*)::integer
            FROM tanaghom.organization_agent_jobs job
           WHERE job.organization_id=version.organization_id
             AND job.agent_version_id=version.id
             AND job.status IN ('queued','running','waiting_approval')) AS open_jobs,
         (SELECT count(*)::integer
            FROM tanaghom.organization_agent_invocations invocation
           WHERE invocation.organization_id=version.organization_id
             AND invocation.job_id IN (
               SELECT job.id FROM tanaghom.organization_agent_jobs job
                WHERE job.organization_id=version.organization_id
                  AND job.agent_version_id=version.id
             )) AS invocations_total,
         (SELECT count(*)::integer
            FROM tanaghom.organization_agent_invocations invocation
           WHERE invocation.organization_id=version.organization_id
             AND invocation.status='waiting_approval'
             AND invocation.job_id IN (
               SELECT job.id FROM tanaghom.organization_agent_jobs job
                WHERE job.organization_id=version.organization_id
                  AND job.agent_version_id=version.id
             )) AS open_approvals,
         (SELECT count(*)::integer
            FROM tanaghom.organization_agent_invocations invocation
           WHERE invocation.organization_id=version.organization_id
             AND (invocation.provider_reference IS NOT NULL
               OR invocation.provider_dispatch_id IS NOT NULL)
             AND invocation.job_id IN (
               SELECT job.id FROM tanaghom.organization_agent_jobs job
                WHERE job.organization_id=version.organization_id
                  AND job.agent_version_id=version.id
             )) AS external_actions,
         (SELECT max(job.updated_at)
            FROM tanaghom.organization_agent_jobs job
           WHERE job.organization_id=version.organization_id
             AND job.agent_version_id=version.id) AS latest_activity_at
       FROM tanaghom.organization_agent_versions version
       WHERE version.organization_id=$1`,
      [user.organizationId],
    ),
    database().query(
      `SELECT DISTINCT ON (certification.agent_version_id)
         certification.id,certification.agent_version_id,
         certification.runtime_profile_id,certification.evidence_hash,
         certification.certified_by,certification.certified_at,
         (certification.evidence->>'scenario_count')::integer AS scenario_count,
         (certification.evidence->>'external_action_count')::integer AS external_action_count
       FROM tanaghom.organization_agent_runtime_certifications certification
       WHERE certification.organization_id=$1
       ORDER BY certification.agent_version_id,certification.certified_at DESC,
         certification.id`,
      [user.organizationId],
    ),
  ]);

  const versionRows = versions.rows as Array<Record<string, unknown>>;
  const bindingRows = skillBindings.rows as Array<Record<string, unknown>>;
  const integrationRows = integrationBindings.rows as Array<Record<string, unknown>>;
  const policyRows = policies.rows as Array<Record<string, unknown>>;
  const scenarioRows = scenarios.rows as Array<Record<string, unknown>>;
  const auditRows = audits.rows as Array<Record<string, unknown>>;
  const activityRows = runtimeActivity.rows as Array<Record<string, unknown>>;
  const certificationRows = runtimeCertifications.rows as Array<Record<string, unknown>>;
  const runtimeProfile = runtimeProfiles.rows[0] as Record<string, unknown> | undefined;
  const runtimeControl = runtimeControls.rows[0] as Record<string, unknown> | undefined;
  const hydrated: Array<Record<string, unknown>> = versionRows.map((version) => ({
    ...version,
    skills: bindingRows.filter((binding) => binding.agent_version_id === version.agent_version_id),
    integrations: integrationRows.filter((binding) => binding.agent_version_id === version.agent_version_id),
    policy: policyRows.find((policy) => policy.agent_version_id === version.agent_version_id) || null,
    scenarios: scenarioRows.filter((scenario) => scenario.agent_version_id === version.agent_version_id),
    audit_events: auditRows.filter((audit) => audit.agent_version_id === version.agent_version_id),
    runtime: activityRows.find((activity) =>
      activity.agent_version_id === version.agent_version_id) || {
      jobs_total: 0,
      open_jobs: 0,
      invocations_total: 0,
      open_approvals: 0,
      external_actions: 0,
      latest_activity_at: null,
    },
    certification: certificationRows.find((certification) =>
      certification.agent_version_id === version.agent_version_id) || null,
  }));
  const agents = hydrated.map((version) => {
    const previous = hydrated.find((candidate) =>
      candidate.agent_id === version.agent_id
      && Number(candidate.version_number) === Number(version.version_number) - 1);
    return { ...version, changed_fields: changedFields(version, previous) };
  });
  return {
    contract_version: "tanaghom.agent-studio.v2",
    can_manage: user.role === "owner",
    templates: templates.rows,
    available_skills: [
      ...platformSkills.rows.map((skill) => ({ ...skill, skill_source: "platform" })),
      ...organizationSkills.rows.map((skill) => ({ ...skill, skill_source: "organization" })),
    ],
    available_knowledge: availableKnowledge.rows,
    connections: connections.rows,
    agents,
    counts: {
      definitions: new Set(versionRows.map((row) => row.agent_id)).size,
      drafts: versionRows.filter((row) => row.lifecycle_state === "draft").length,
      validated: versionRows.filter((row) => row.lifecycle_state === "validated").length,
      running: versionRows.filter((row) => ["shadow", "assisted", "active"].includes(String(row.lifecycle_state))).length,
    },
    safety: {
      automatic_mode_available: false,
      runtime_executor_available: Boolean(runtimeProfile && runtimeControl),
      runtime_profile: runtimeProfile || null,
      runtime_claims_paused: runtimeControl?.emergency_stop !== false,
      runtime_stop_reason: runtimeControl?.reason || "Shared runtime control is unavailable",
      runtime_control_updated_at: runtimeControl?.updated_at || null,
      provider_calls_from_studio: false,
      provider_execution_enabled: process.env.AGENT_RUNTIME_PROVIDER_EXECUTION_ENABLED === "true",
      credentials_exposed_to_browser: false,
      mandatory_scenarios_per_language: 7,
      next_gate: runtimeProfile && runtimeControl
        ? "Complete bilingual zero-action certification before simulation promotion"
        : "Install the reviewed shared runtime before certification",
    },
  };
}

export async function createAgentDraft(request: NextRequest) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  let input;
  try {
    input = parseOrganizationAgentDraft(await request.json());
  } catch (error) {
    if (error instanceof AgentStudioValidationError) {
      throw new AgentStudioRequestError("agent_validation_failed", error.status, error.issues);
    }
    throw error;
  }
  const payload = {
    code: input.code,
    template_code: input.template_code,
    display_name: input.display_name,
    description: input.description,
    objective: input.objective,
    responsibility: input.responsibility,
    tone: input.tone,
    brand_profile_key: input.brand_profile_key,
    languages: input.languages,
    knowledge_keys: input.knowledge_keys,
    skills: input.skills,
    integrations: input.integrations,
    policy: input.policy,
  };
  try {
    const result = await database().query(
      "SELECT * FROM tanaghom.create_organization_agent_draft($1,$2,$3::jsonb,$4,$5::uuid)",
      [
        owner.organizationId,
        owner.id,
        JSON.stringify(payload),
        input.content_hash,
        input.clone_source_version_id,
      ],
    );
    return { ...result.rows[0], content_hash: input.content_hash };
  } catch (error) {
    throw mappedDatabaseError(error);
  }
}

export async function transitionAgentVersion(request: NextRequest, versionId: string) {
  enforceSameOriginForCookieMutation(request);
  const owner = await authorize(request, ["owner"]);
  if (!uuidPattern.test(versionId)) throw new AgentStudioRequestError("agent_version_invalid");
  const body = await request.json() as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  if (!lifecycleActions.has(action)) throw new AgentStudioRequestError("agent_action_invalid");

  let report: Record<string, unknown> | null = null;
  if (action === "validate") {
    const source = await database().query(
      `SELECT content_hash FROM tanaghom.organization_agent_versions
       WHERE id=$1 AND organization_id=$2 AND lifecycle_state='draft'`,
      [versionId, owner.organizationId],
    );
    if (!source.rows[0]) throw new AgentStudioRequestError("agent_version_not_found", 404);
    report = agentValidationReport({
      content_hash: source.rows[0].content_hash,
    } as Parameters<typeof agentValidationReport>[0]);
  }
  try {
    const result = await database().query(
      "SELECT * FROM tanaghom.transition_organization_agent_version($1,$2,$3,$4,$5::jsonb)",
      [owner.organizationId, owner.id, versionId, action, report ? JSON.stringify(report) : null],
    );
    return result.rows[0];
  } catch (error) {
    throw mappedDatabaseError(error);
  }
}
