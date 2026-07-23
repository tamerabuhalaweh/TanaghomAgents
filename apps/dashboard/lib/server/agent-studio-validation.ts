import { createHash } from "node:crypto";

export type AgentLanguage = "en" | "ar";
export type AgentOperatingMode = "disabled" | "manual" | "shadow" | "assisted";
export type AgentChannel =
  | "email" | "facebook" | "instagram" | "linkedin" | "live_chat"
  | "sms" | "tiktok" | "whatsapp" | "x" | "youtube";

export interface AgentSkillBindingInput {
  skill_source: "platform" | "organization";
  skill_version_id: string;
  operating_mode: AgentOperatingMode;
  approval_required: boolean;
  constraints: Record<string, string | number | boolean>;
}

export interface AgentIntegrationBindingInput {
  connection_id: string;
  provider: "postiz" | "ghl";
  purpose: string;
  channels: AgentChannel[];
}

export interface AgentPolicyInput {
  business_timezone: string;
  business_hours: Array<{ day: number; start: string; end: string }>;
  allowed_channels: AgentChannel[];
  consent_required: boolean;
  max_steps: number;
  max_tool_calls: number;
  max_retries: number;
  max_concurrency: number;
  max_runtime_seconds: number;
  max_tokens: number;
  max_daily_actions: number;
  max_actions_per_minute: number;
  max_follow_ups_per_contact: number;
  monthly_budget: number;
  allowed_record_types: string[];
  allowed_action_types: string[];
  approval_actions: string[];
  approval_roles: Array<"owner" | "reviewer">;
  approval_expiry_minutes: number;
  parameter_bound_approval: boolean;
  escalation_conditions: string[];
}

export interface OrganizationAgentDraftInput {
  code: string;
  template_code: string | null;
  display_name: string;
  description: string;
  objective: string;
  responsibility: string;
  tone: string;
  brand_profile_key: string | null;
  languages: AgentLanguage[];
  knowledge_keys: string[];
  skills: AgentSkillBindingInput[];
  integrations: AgentIntegrationBindingInput[];
  policy: AgentPolicyInput;
  clone_source_version_id: string | null;
  content_hash: string;
}

export interface AgentStudioValidationIssue {
  field: string;
  code: string;
  message: string;
}

export class AgentStudioValidationError extends Error {
  readonly issues: AgentStudioValidationIssue[];
  readonly status: number;

  constructor(
    issues: AgentStudioValidationIssue[],
    status = 422,
  ) {
    super("agent_studio_validation_failed");
    this.issues = issues;
    this.status = status;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const codePattern = /^[a-z][a-z0-9_]{2,79}$/;
const tokenPattern = /^[a-z][a-z0-9._-]{1,79}$/;
const knowledgePattern = /^knowledge\/[a-z0-9][a-z0-9_-]{2,79}\/v[1-9][0-9]*$/;
const brandPattern = /^brand\/[a-z0-9][a-z0-9_./-]{2,199}$/;
const timePattern = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const hiddenControlPattern = /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
const unsafePatterns = [
  { code: "url_not_allowed", pattern: /\b(?:https?|file|javascript|data):\/\//iu },
  { code: "secret_not_allowed", pattern: /\b(?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|password)\s*[:=]/iu },
  { code: "private_key_not_allowed", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu },
  { code: "command_not_allowed", pattern: /(^|\s)(?:sudo|ssh|scp|curl|wget|powershell|cmd\.exe|\/bin\/(?:sh|bash))(\s|$)/iu },
  { code: "code_not_allowed", pattern: /```|~~~|<\s*(?:script|iframe|object|embed)(?:\s|>)/iu },
  { code: "runtime_identifier_not_allowed", pattern: /\b(?:n8n[_ -]?(?:workflow|credential)[_ -]?id|mcp:\/\/)\b/iu },
  { code: "hidden_instruction_not_allowed", pattern: /\b(?:ignore|override|disregard)\s+(?:all\s+|any\s+|every\s+|the\s+)?(?:(?:previous|prior)\s+)?(?:system|developer)?\s*(?:instructions?|messages?)\b/iu },
] as const;
const allowedChannels = new Set<AgentChannel>([
  "email", "facebook", "instagram", "linkedin", "live_chat",
  "sms", "tiktok", "whatsapp", "x", "youtube",
]);
const allowedTopLevel = new Set([
  "code", "template_code", "display_name", "description", "objective", "responsibility",
  "tone", "brand_profile_key", "languages", "knowledge_keys", "skills", "integrations", "policy",
  "clone_source_version_id",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function uniqueStrings(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))].slice(0, maximum + 1);
}

function freeTextIssues(
  field: string,
  value: string,
  minimum: number,
  maximum: number,
) {
  const issues: AgentStudioValidationIssue[] = [];
  if (value.length < minimum || value.length > maximum) {
    issues.push({
      field,
      code: "length_invalid",
      message: `${field} must be between ${minimum} and ${maximum} characters.`,
    });
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || hiddenControlPattern.test(value)) {
    issues.push({ field, code: "hidden_content_not_allowed", message: `${field} contains hidden control characters.` });
  }
  for (const rule of unsafePatterns) {
    if (rule.pattern.test(value)) {
      issues.push({ field, code: rule.code, message: `${field} contains content that Agent Studio cannot accept.` });
    }
  }
  return issues;
}

function closed(
  field: string,
  value: Record<string, unknown>,
  allowed: readonly string[],
  issues: AgentStudioValidationIssue[],
) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    issues.push({
      field,
      code: "unknown_fields",
      message: `${field} contains unsupported fields: ${unknown.join(", ")}.`,
    });
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(stable(value), "utf8").digest("hex")}`;
}

function parseSkills(value: unknown, issues: AgentStudioValidationIssue[]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    issues.push({ field: "skills", code: "skills_invalid", message: "Select between one and twenty approved Skill versions." });
    return [];
  }
  const seen = new Set<string>();
  return value.flatMap((item, index): AgentSkillBindingInput[] => {
    const source = record(item);
    const field = `skills.${index}`;
    closed(field, source, ["skill_source", "skill_version_id", "operating_mode", "approval_required", "constraints"], issues);
    const skill_source = text(source.skill_source);
    const skill_version_id = text(source.skill_version_id);
    const operating_mode = text(source.operating_mode);
    const constraints = record(source.constraints);
    if (!["platform", "organization"].includes(skill_source)
      || !uuidPattern.test(skill_version_id)
      || !["disabled", "manual", "shadow", "assisted"].includes(operating_mode)
      || typeof source.approval_required !== "boolean"
      || Object.keys(constraints).length > 0
    ) {
      issues.push({ field, code: "skill_binding_invalid", message: "Skill source, version, mode, approval, or constraints are invalid. Skill-specific constraints are not available in this release." });
      return [];
    }
    if (seen.has(skill_version_id)) {
      issues.push({ field, code: "skill_duplicate", message: "Assign each exact Skill version only once." });
      return [];
    }
    seen.add(skill_version_id);
    if (operating_mode === "assisted" && source.approval_required !== true) {
      issues.push({ field, code: "approval_required", message: "Assisted mode requires explicit human approval." });
    }
    return [{
      skill_source: skill_source as AgentSkillBindingInput["skill_source"],
      skill_version_id,
      operating_mode: operating_mode as AgentOperatingMode,
      approval_required: source.approval_required,
      constraints: constraints as AgentSkillBindingInput["constraints"],
    }];
  });
}

function parseIntegrations(value: unknown, issues: AgentStudioValidationIssue[]) {
  if (!Array.isArray(value) || value.length > 8) {
    issues.push({ field: "integrations", code: "integrations_invalid", message: "Use no more than eight existing organization integrations." });
    return [];
  }
  const providers = new Set<string>();
  return value.flatMap((item, index): AgentIntegrationBindingInput[] => {
    const source = record(item);
    const field = `integrations.${index}`;
    closed(field, source, ["connection_id", "provider", "purpose", "channels"], issues);
    const connection_id = text(source.connection_id);
    const provider = text(source.provider);
    const purpose = text(source.purpose);
    const channels = uniqueStrings(source.channels, 12);
    if (!uuidPattern.test(connection_id)
      || !["postiz", "ghl"].includes(provider)
      || channels.length < 1
      || channels.some((channel) => !allowedChannels.has(channel as AgentChannel))
      || (provider === "ghl" && channels.some((channel) =>
        !["email", "live_chat", "sms", "whatsapp"].includes(channel)))
      || (provider === "postiz" && channels.some((channel) =>
        !["facebook", "instagram", "linkedin", "tiktok", "x", "youtube"].includes(channel)))
    ) {
      issues.push({ field, code: "integration_binding_invalid", message: "Integration connection, provider, or channel is missing or incompatible." });
      return [];
    }
    issues.push(...freeTextIssues(`${field}.purpose`, purpose, 3, 200));
    if (providers.has(provider)) {
      issues.push({ field, code: "provider_duplicate", message: "Bind each provider only once per agent version." });
      return [];
    }
    providers.add(provider);
    return [{
      connection_id,
      provider: provider as AgentIntegrationBindingInput["provider"],
      purpose,
      channels: channels as AgentChannel[],
    }];
  });
}

function parsePolicy(value: unknown, issues: AgentStudioValidationIssue[]): AgentPolicyInput {
  const source = record(value);
  closed("policy", source, [
    "business_timezone", "business_hours", "allowed_channels", "consent_required",
    "max_steps", "max_tool_calls", "max_retries", "max_concurrency", "max_runtime_seconds",
    "max_tokens", "max_daily_actions", "max_actions_per_minute", "max_follow_ups_per_contact",
    "monthly_budget", "allowed_record_types", "allowed_action_types", "approval_actions",
    "approval_roles", "approval_expiry_minutes", "parameter_bound_approval",
    "escalation_conditions",
  ], issues);
  const business_timezone = text(source.business_timezone);
  try {
    new Intl.DateTimeFormat("en", { timeZone: business_timezone }).format();
  } catch {
    issues.push({ field: "policy.business_timezone", code: "timezone_invalid", message: "Use a supported IANA timezone such as Asia/Amman." });
  }
  const business_hours = Array.isArray(source.business_hours)
    ? source.business_hours.flatMap((item, index) => {
      const period = record(item);
      closed(`policy.business_hours.${index}`, period, ["day", "start", "end"], issues);
      const day = integer(period.day);
      const start = text(period.start);
      const end = text(period.end);
      if (day < 0 || day > 6 || !timePattern.test(start) || !timePattern.test(end) || start >= end) {
        issues.push({ field: `policy.business_hours.${index}`, code: "business_hours_invalid", message: "Business-hour entries require a day and an increasing HH:MM range." });
        return [];
      }
      return [{ day, start, end }];
    })
    : [];
  if (!Array.isArray(source.business_hours) || business_hours.length > 14) {
    issues.push({ field: "policy.business_hours", code: "business_hours_invalid", message: "Use no more than fourteen valid business-hour ranges." });
  }
  const allowed_channels = uniqueStrings(source.allowed_channels, 12);
  if (allowed_channels.some((channel) => !allowedChannels.has(channel as AgentChannel))) {
    issues.push({ field: "policy.allowed_channels", code: "channels_invalid", message: "One or more policy channels are unsupported." });
  }
  const approval_actions = uniqueStrings(source.approval_actions, 20);
  if (approval_actions.some((action) => !tokenPattern.test(action))) {
    issues.push({ field: "policy.approval_actions", code: "approval_actions_invalid", message: "Approval actions must be safe contract tokens." });
  }
  const allowed_record_types = uniqueStrings(source.allowed_record_types, 20);
  const allowed_action_types = uniqueStrings(source.allowed_action_types, 20);
  if ([...allowed_record_types, ...allowed_action_types].some((item) => !tokenPattern.test(item))) {
    issues.push({ field: "policy.allowed_records_actions", code: "records_actions_invalid", message: "Allowed records and actions must be safe contract tokens." });
  }
  const approval_roles = uniqueStrings(source.approval_roles, 2);
  if (!approval_roles.length || approval_roles.some((role) => !["owner", "reviewer"].includes(role))) {
    issues.push({ field: "policy.approval_roles", code: "approval_roles_invalid", message: "Select at least one eligible human approval role." });
  }
  if (typeof source.parameter_bound_approval !== "boolean"
    || (approval_actions.length > 0 && source.parameter_bound_approval !== true)) {
    issues.push({ field: "policy.parameter_bound_approval", code: "parameter_binding_required", message: "Approval must be bound to the exact proposed action parameters." });
  }
  const escalation_conditions = uniqueStrings(source.escalation_conditions, 20);
  if (!escalation_conditions.length || escalation_conditions.length > 20) {
    issues.push({ field: "policy.escalation_conditions", code: "escalations_invalid", message: "Add between one and twenty escalation conditions." });
  }
  escalation_conditions.forEach((condition, index) => {
    issues.push(...freeTextIssues(`policy.escalation_conditions.${index}`, condition, 10, 500));
  });
  const ranges = [
    ["max_steps", integer(source.max_steps), 1, 20],
    ["max_tool_calls", integer(source.max_tool_calls), 0, 20],
    ["max_retries", integer(source.max_retries), 0, 5],
    ["max_concurrency", integer(source.max_concurrency), 1, 20],
    ["max_runtime_seconds", integer(source.max_runtime_seconds), 30, 1800],
    ["max_tokens", integer(source.max_tokens), 100, 32000],
    ["max_daily_actions", integer(source.max_daily_actions), 0, 1000],
    ["max_actions_per_minute", integer(source.max_actions_per_minute), 0, 100],
    ["max_follow_ups_per_contact", integer(source.max_follow_ups_per_contact), 0, 20],
    ["approval_expiry_minutes", integer(source.approval_expiry_minutes), 5, 10080],
    ["monthly_budget", number(source.monthly_budget), 0, 1_000_000],
  ] as const;
  for (const [field, amount, minimum, maximum] of ranges) {
    if (!Number.isFinite(amount) || amount < minimum || amount > maximum) {
      issues.push({ field: `policy.${field}`, code: "limit_invalid", message: `${field} must be between ${minimum} and ${maximum}.` });
    }
  }
  if (typeof source.consent_required !== "boolean") {
    issues.push({ field: "policy.consent_required", code: "consent_invalid", message: "Consent policy must be explicitly true or false." });
  }
  return {
    business_timezone,
    business_hours,
    allowed_channels: allowed_channels as AgentChannel[],
    consent_required: source.consent_required === true,
    max_steps: integer(source.max_steps),
    max_tool_calls: integer(source.max_tool_calls),
    max_retries: integer(source.max_retries),
    max_concurrency: integer(source.max_concurrency),
    max_runtime_seconds: integer(source.max_runtime_seconds),
    max_tokens: integer(source.max_tokens),
    max_daily_actions: integer(source.max_daily_actions),
    max_actions_per_minute: integer(source.max_actions_per_minute),
    max_follow_ups_per_contact: integer(source.max_follow_ups_per_contact),
    monthly_budget: number(source.monthly_budget),
    allowed_record_types,
    allowed_action_types,
    approval_actions,
    approval_roles: approval_roles as AgentPolicyInput["approval_roles"],
    approval_expiry_minutes: integer(source.approval_expiry_minutes),
    parameter_bound_approval: source.parameter_bound_approval === true,
    escalation_conditions,
  };
}

export function parseOrganizationAgentDraft(body: unknown): OrganizationAgentDraftInput {
  const source = record(body);
  const issues: AgentStudioValidationIssue[] = [];
  const unknown = Object.keys(source).filter((key) => !allowedTopLevel.has(key));
  if (unknown.length) {
    issues.push({ field: "agent", code: "unknown_fields", message: `Agent draft contains unsupported fields: ${unknown.join(", ")}.` });
  }
  const code = text(source.code).toLowerCase();
  const template = text(source.template_code);
  const display_name = text(source.display_name);
  const description = text(source.description);
  const objective = text(source.objective);
  const responsibility = text(source.responsibility);
  const tone = text(source.tone);
  const brandProfile = text(source.brand_profile_key).toLowerCase();
  const languages = uniqueStrings(source.languages, 2);
  const knowledge_keys = uniqueStrings(source.knowledge_keys, 20).map((key) => key.toLowerCase());
  const cloneSource = text(source.clone_source_version_id);
  if (!codePattern.test(code)) {
    issues.push({ field: "code", code: "code_invalid", message: "Code must use lowercase letters, numbers, and underscores." });
  }
  if (template && !codePattern.test(template)) {
    issues.push({ field: "template_code", code: "template_invalid", message: "Template reference is invalid." });
  }
  issues.push(...freeTextIssues("display_name", display_name, 3, 120));
  issues.push(...freeTextIssues("description", description, 20, 1000));
  issues.push(...freeTextIssues("objective", objective, 10, 500));
  issues.push(...freeTextIssues("responsibility", responsibility, 20, 1000));
  issues.push(...freeTextIssues("tone", tone, 3, 120));
  if (brandProfile && (!brandPattern.test(brandProfile) || brandProfile.includes(".."))) {
    issues.push({ field: "brand_profile_key", code: "brand_invalid", message: "Brand profile must be an approved organization key such as brand/tanaghom." });
  }
  if (!languages.length || languages.length > 2 || languages.some((language) => !["en", "ar"].includes(language))) {
    issues.push({ field: "languages", code: "languages_invalid", message: "Select English, Arabic, or both." });
  }
  if (knowledge_keys.length > 20 || knowledge_keys.some((key) => !knowledgePattern.test(key) || key.includes(".."))) {
    issues.push({ field: "knowledge_keys", code: "knowledge_invalid", message: "Knowledge references must be safe organization keys, not URLs or paths." });
  }
  if (cloneSource && !uuidPattern.test(cloneSource)) {
    issues.push({ field: "clone_source_version_id", code: "clone_source_invalid", message: "Agent version source is invalid." });
  }
  const skills = parseSkills(source.skills, issues);
  const integrations = parseIntegrations(source.integrations, issues);
  const policy = parsePolicy(source.policy, issues);
  if (issues.length) throw new AgentStudioValidationError(issues);

  const payload = {
    code,
    template_code: template || null,
    display_name,
    description,
    objective,
    responsibility,
    tone,
    brand_profile_key: brandProfile || null,
    languages: languages as AgentLanguage[],
    knowledge_keys,
    skills,
    integrations,
    policy,
  };
  return {
    ...payload,
    clone_source_version_id: cloneSource || null,
    content_hash: hash(payload),
  };
}

export function agentValidationReport(input: OrganizationAgentDraftInput) {
  return {
    valid: true,
    validator_version: "tanaghom.organization-agent.v1",
    content_hash: input.content_hash,
    checked_boundaries: [
      "closed_contract",
      "tenant_bound_references",
      "published_skill_versions",
      "active_tenant_knowledge_versions",
      "compatible_provider_channels",
      "no_automatic_mode",
      "assisted_requires_approval",
      "parameter_bound_human_approval",
      "customer_managed_integrations_only",
      "bounded_limits",
      "bilingual_safety_scenarios_prepared",
      "no_runtime_activation",
    ],
    runtime_certified: false,
  };
}
