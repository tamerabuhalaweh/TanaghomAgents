import "server-only";

export type RegistryBlockerSeverity = "blocking" | "attention" | "info";

export interface RegistryBlocker {
  code: string;
  title: string;
  detail: string;
  next_action: string;
  severity: RegistryBlockerSeverity;
}

interface RoleRow {
  code: string;
  name: string;
  short_name: string;
  responsibility: string;
  display_order: number;
  agent_record_id: string | null;
}

interface WorkerRow {
  code: string;
  role_code: string;
  name: string;
  responsibility: string;
  phase: string;
  workflow_name: string;
  workflow_version: string;
  source_path: string;
  job_types: string[];
  release_state: "available" | "retired";
  runtime_state: "available_not_imported" | "imported_inactive" | "active";
  trigger_state: "disabled" | "workflow_inactive_only" | "enabled";
  runtime_verified_at: string;
  runtime_evidence: string;
  display_order: number;
}

export interface RegistryJobRow {
  id: string;
  worker_code: string | null;
  job_type: string;
  status: string;
  campaign_id: string | null;
  campaign_name: string | null;
  attempt: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
  pending_approvals: number;
  requires_reconciliation: boolean;
}

interface ProviderReadiness {
  postiz: {
    mode: string;
    emergency_stop: boolean;
    emergency_stop_reason: string;
    connection_ready: boolean;
    channel_mapping_ready: boolean;
    operations_clear: boolean;
    runtime_blockers: string[];
  };
  ghl: {
    mode: string;
    proactive_message_mode: string;
    platform_emergency_stop: boolean;
    organization_emergency_stop: boolean;
    organization_emergency_reason: string;
    connection_ready: boolean;
    operations_clear: boolean;
    allowed_channels: string[];
    runtime_blockers: string[];
  };
  quality: {
    current_stage: string;
    minimum_sample_size: number;
    dataset_count: number;
    baseline_recorded_count: number;
    shadow_job_count: number;
  };
}

const blockerCatalog: Record<string, Omit<RegistryBlocker, "code">> = {
  workflow_not_imported: {
    title: "Workflow is not imported",
    detail: "The reviewed workflow exists in this release but is not present in the production n8n inventory.",
    next_action: "A platform operator must import the pinned export inactive and verify its runtime identity.",
    severity: "blocking",
  },
  workflow_inactive: {
    title: "Workflow activation is off",
    detail: "The workflow was imported and verified, but n8n activation remains protected and off.",
    next_action: "Complete the worker-specific readiness gate, then authorize a controlled platform activation.",
    severity: "blocking",
  },
  polling_disabled: {
    title: "Automatic polling is disabled",
    detail: "The workflow cannot claim jobs on a schedule. Manual controlled execution remains the only trigger path.",
    next_action: "Keep polling disabled for shadow/manual use or approve a separate schedule activation review.",
    severity: "attention",
  },
  activation_enables_polling: {
    title: "Activation would enable polling",
    detail: "This Phase 3 export has a schedule trigger that is contained only because the whole workflow is inactive.",
    next_action: "Disable or explicitly authorize its schedule before activating the workflow.",
    severity: "attention",
  },
  role_runtime_missing: {
    title: "No runtime agent record",
    detail: "The business role is defined, but the operational agent row required for queue claims is absent.",
    next_action: "Register the role in the controlled production seed before queueing work.",
    severity: "blocking",
  },
  content_job_reconciliation_required: {
    title: "Approval job requires reconciliation",
    detail: "A content job is still marked as waiting for approval even though its campaign has no pending content decisions.",
    next_action: "Run the controlled content-job completion check and preserve the resulting audit record.",
    severity: "attention",
  },
  postiz_connection_not_ready: {
    title: "Postiz connection is not ready",
    detail: "No verified customer Postiz connection is available to the private integration gateway.",
    next_action: "An owner must save and test a customer-managed Postiz credential in Settings.",
    severity: "blocking",
  },
  postiz_channel_mapping_not_ready: {
    title: "Postiz channel mapping is missing",
    detail: "Tanaghom cannot resolve an approved content channel to an active Postiz integration.",
    next_action: "Connect a supported business channel in Postiz, then activate its Tanaghom mapping.",
    severity: "blocking",
  },
  postiz_emergency_stop: {
    title: "Postiz emergency stop is active",
    detail: "The platform safety control blocks new Postiz worker claims.",
    next_action: "Keep the stop active until the protected runtime and a controlled draft test are approved.",
    severity: "blocking",
  },
  postiz_manual_policy: {
    title: "Postiz policy is manual",
    detail: "Only an explicit human-controlled Sync to Postiz request may queue a draft.",
    next_action: "Use manual draft sync for UAT or approve automatic-draft policy after its full readiness gate passes.",
    severity: "info",
  },
  postiz_operation_indeterminate: {
    title: "A Postiz outcome is indeterminate",
    detail: "Tanaghom cannot safely determine whether a previous provider operation took effect.",
    next_action: "Reconcile the provider result before allowing any new automatic operation.",
    severity: "blocking",
  },
  ghl_connection_not_ready: {
    title: "GoHighLevel connection is not ready",
    detail: "No verified customer GoHighLevel connection is available to the private integration gateway.",
    next_action: "An owner must save and test customer-managed GHL credentials in Settings.",
    severity: "blocking",
  },
  ghl_platform_emergency_stop: {
    title: "GHL platform stop is active",
    detail: "The platform-level safety control blocks protected GHL worker calls.",
    next_action: "Clear it only after gateway, credential, and controlled provider tests pass.",
    severity: "blocking",
  },
  ghl_organization_emergency_stop: {
    title: "Organization GHL stop is active",
    detail: "The customer policy blocks new governed GHL actions for this workspace.",
    next_action: "An owner may resume actions only after the runtime readiness checks are green.",
    severity: "blocking",
  },
  ghl_manual_policy: {
    title: "GHL action policy is manual",
    detail: "Agents may prepare evidence, but autonomous provider actions are not authorized.",
    next_action: "Use shadow or assisted UAT before considering bounded autonomy.",
    severity: "info",
  },
  ghl_channels_missing: {
    title: "No outbound GHL channels are allowed",
    detail: "The governed action policy has no approved WhatsApp, SMS, email, or social channel.",
    next_action: "An owner must select channels after consent, template, and provider testing is complete.",
    severity: "blocking",
  },
  ghl_operation_indeterminate: {
    title: "A GHL outcome is indeterminate",
    detail: "A previous provider action cannot be safely classified as applied or not applied.",
    next_action: "A human must verify and reconcile the provider outcome; do not retry it blindly.",
    severity: "blocking",
  },
  quality_baseline_missing: {
    title: "Human baseline is missing",
    detail: "No customer-approved de-identified baseline dataset is available for human-versus-AI comparison.",
    next_action: "Import the first reviewed English/Arabic baseline before queueing shadow evaluations.",
    severity: "blocking",
  },
  quality_stage_baseline: {
    title: "Quality rollout remains at baseline",
    detail: "The rollout gate has not advanced to AI shadow evaluation.",
    next_action: "Record the minimum baseline sample and explicitly approve the shadow-stage transition.",
    severity: "attention",
  },
  runtime_not_enabled: {
    title: "Protected runtime is not enabled",
    detail: "The server-side worker readiness flag remains off.",
    next_action: "Enable it only through a reviewed deployment after all worker boundaries pass.",
    severity: "blocking",
  },
  credential_vault_not_ready: {
    title: "Credential vault is not ready",
    detail: "Customer credentials cannot be safely decrypted by the private integration gateway.",
    next_action: "Configure and validate the server-side encryption key without exposing it to n8n or the browser.",
    severity: "blocking",
  },
  worker_authentication_not_ready: {
    title: "Worker authentication is not ready",
    detail: "The protected n8n-to-dashboard gateway authentication boundary is incomplete.",
    next_action: "Import the reviewed n8n header credential and validate rejected unauthenticated calls.",
    severity: "blocking",
  },
  gateway_not_ready: {
    title: "Private integration gateway is not ready",
    detail: "The worker has no reviewed private URL for credential-bearing provider operations.",
    next_action: "Deploy and validate the fixed private dashboard gateway before activation.",
    severity: "blocking",
  },
};

function blocker(code: string): RegistryBlocker {
  const content = blockerCatalog[code] || {
    title: "Runtime readiness is incomplete",
    detail: `The platform reported the unresolved condition: ${code.replaceAll("_", " ")}.`,
    next_action: "Review the protected runtime configuration before activation.",
    severity: "blocking" as const,
  };
  return { code, ...content };
}

function uniqueBlockers(codes: string[]) {
  return [...new Set(codes)].map(blocker);
}

function workerBlockerCodes(worker: WorkerRow, readiness: ProviderReadiness) {
  const codes: string[] = [];
  if (worker.runtime_state === "available_not_imported") codes.push("workflow_not_imported");
  if (worker.runtime_state === "imported_inactive") codes.push("workflow_inactive");
  if (worker.trigger_state === "disabled") codes.push("polling_disabled");
  if (worker.trigger_state === "workflow_inactive_only") codes.push("activation_enables_polling");

  if (worker.code.startsWith("postiz_")) {
    codes.push(...readiness.postiz.runtime_blockers);
    if (readiness.postiz.emergency_stop) codes.push("postiz_emergency_stop");
    if (!readiness.postiz.connection_ready) codes.push("postiz_connection_not_ready");
    if (!readiness.postiz.channel_mapping_ready) codes.push("postiz_channel_mapping_not_ready");
    if (!readiness.postiz.operations_clear) codes.push("postiz_operation_indeterminate");
    if (readiness.postiz.mode === "manual") codes.push("postiz_manual_policy");
  }
  if (worker.code === "ghl_contact_sync" || worker.code === "governed_ghl_actions") {
    codes.push(...readiness.ghl.runtime_blockers);
    if (readiness.ghl.platform_emergency_stop) codes.push("ghl_platform_emergency_stop");
    if (readiness.ghl.organization_emergency_stop) codes.push("ghl_organization_emergency_stop");
    if (!readiness.ghl.connection_ready) codes.push("ghl_connection_not_ready");
    if (!readiness.ghl.operations_clear) codes.push("ghl_operation_indeterminate");
    if (readiness.ghl.mode === "manual") codes.push("ghl_manual_policy");
    if (worker.code === "governed_ghl_actions" && readiness.ghl.allowed_channels.length === 0) {
      codes.push("ghl_channels_missing");
    }
  }
  if (worker.code === "quality_shadow_evaluator") {
    if (readiness.quality.dataset_count === 0) codes.push("quality_baseline_missing");
    if (readiness.quality.current_stage === "baseline") codes.push("quality_stage_baseline");
  }
  return uniqueBlockers(codes);
}

export function buildAgentRegistry(input: {
  roles: RoleRow[];
  workers: WorkerRow[];
  jobs: Array<RegistryJobRow & { role_code: string }>;
  readiness: ProviderReadiness;
}) {
  const workers = input.workers.map((worker) => ({
    ...worker,
    blockers: workerBlockerCodes(worker, input.readiness),
  }));
  const roles = input.roles.map((role) => {
    const roleWorkers = workers.filter((worker) => worker.role_code === role.code);
    const jobs = input.jobs.filter((job) => job.role_code === role.code);
    const liveJob = jobs.find((job) => ["queued", "running", "waiting_approval"].includes(job.status)) || null;
    const jobBlockers = jobs.some((job) => job.requires_reconciliation)
      ? [blocker("content_job_reconciliation_required")]
      : [];
    const blockers = [
      ...(!role.agent_record_id ? [blocker("role_runtime_missing")] : []),
      ...jobBlockers,
      ...roleWorkers.flatMap((worker) => worker.blockers),
    ].filter((item, index, all) => all.findIndex((candidate) => candidate.code === item.code) === index);
    const operationalState = liveJob?.requires_reconciliation
      ? "blocked"
      : liveJob?.status === "running"
        ? "working"
        : liveJob?.status === "waiting_approval"
          ? "waiting_approval"
          : roleWorkers.some((worker) => worker.runtime_state === "active")
            ? "ready"
            : "inactive";
    return {
      ...role,
      operational_state: operationalState,
      current_job: liveJob,
      recent_jobs: jobs,
      blockers,
      workers: roleWorkers,
    };
  });

  return {
    contract_version: "tanaghom.agent-registry.v1",
    generated_at: new Date().toISOString(),
    summary: {
      business_roles: roles.length,
      specialized_workers: workers.length,
      release_available: workers.filter((worker) => worker.release_state === "available").length,
      imported: workers.filter((worker) => worker.runtime_state !== "available_not_imported").length,
      active: workers.filter((worker) => worker.runtime_state === "active").length,
      jobs_open: input.jobs.filter((job) => ["queued", "running", "waiting_approval"].includes(job.status)).length,
      jobs_requiring_reconciliation: input.jobs.filter((job) => job.requires_reconciliation).length,
    },
    roles,
  };
}
