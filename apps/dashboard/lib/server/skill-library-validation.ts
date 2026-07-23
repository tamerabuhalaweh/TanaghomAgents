import { createHash } from "node:crypto";

export type OrganizationSkillClass = "knowledge" | "proposal_instruction";
export type SkillLanguage = "en" | "ar";

export interface OrganizationSkillReferenceInput {
  reference_type: "knowledge_collection" | "approved_document" | "approved_asset";
  reference_key: string;
  title: string;
  language: SkillLanguage | "und";
  provenance: string;
  expires_at: string | null;
  content_hash: string;
}

export interface OrganizationSkillDraftInput {
  code: string;
  skill_class: OrganizationSkillClass;
  display_name: string;
  description: string;
  activation_guidance: string;
  instructions: string;
  examples: string[];
  expected_inputs: string[];
  expected_outputs: string[];
  escalation_conditions: string;
  languages: SkillLanguage[];
  references: OrganizationSkillReferenceInput[];
  clone_source_version_id: string | null;
  content_hash: string;
}

export interface SkillValidationIssue {
  field: string;
  code: string;
  message: string;
}

export class SkillLibraryValidationError extends Error {
  readonly issues: SkillValidationIssue[];
  readonly status: number;

  constructor(issues: SkillValidationIssue[], status = 422) {
    super("skill_library_validation_failed");
    this.issues = issues;
    this.status = status;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPattern = /^[a-z][a-z0-9._-]{1,79}$/;
const referenceKeyPattern = /^(knowledge|document|asset)\/[a-z0-9][a-z0-9_./-]{2,199}$/;
const hiddenControlPattern = /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
const unsupportedContentPatterns = [
  { code: "frontmatter_not_allowed", pattern: /(^|\n)\s*---\s*(\n|$)/u },
  { code: "code_block_not_allowed", pattern: /```|~~~/u },
  { code: "url_not_allowed", pattern: /\b(?:https?|file|javascript|data):\/\//iu },
  { code: "private_key_not_allowed", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu },
  { code: "secret_not_allowed", pattern: /\b(?:api[_ -]?key|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|password)\s*[:=]/iu },
  { code: "bearer_token_not_allowed", pattern: /\bbearer\s+[a-z0-9._-]{8,}/iu },
  { code: "command_not_allowed", pattern: /(^|\s)(?:sudo|ssh|scp|curl|wget|powershell|cmd\.exe|\/bin\/(?:sh|bash))(\s|$)/iu },
  { code: "package_not_allowed", pattern: /\b(?:npm|pnpm|yarn|pip|pipx|apt|apk)\s+(?:add|install|run|exec)\b/iu },
  { code: "filesystem_path_not_allowed", pattern: /(?:\b[a-z]:\\|\/(?:etc|opt|var|home|root|tmp)\/|\.\.\/)/iu },
  { code: "sql_not_allowed", pattern: /\b(?:insert\s+into|delete\s+from|drop\s+table|alter\s+table|create\s+(?:table|function|role)|grant\s+\w+\s+on|revoke\s+\w+\s+on|select\s+.+\s+from\s+[a-z_][a-z0-9_]*\.)/iu },
  { code: "executable_markup_not_allowed", pattern: /<\s*(?:script|iframe|object|embed)(?:\s|>)/iu },
  { code: "runtime_identifier_not_allowed", pattern: /\bn8n[_ -]?(?:workflow|credential)[_ -]?id\b/iu },
  { code: "mcp_runtime_not_allowed", pattern: /\b(?:mcp:\/\/|mcp\s+(?:server|tool))\b/iu },
  { code: "hidden_instruction_not_allowed", pattern: /\b(?:ignore|override|disregard)\s+(?:all\s+|any\s+|the\s+)?(?:previous|system|developer)\s+(?:instructions?|messages?)\b/iu },
  { code: "system_prompt_not_allowed", pattern: /\b(?:reveal|print|return|expose)\s+(?:the\s+)?system\s+prompt\b/iu },
] as const;

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function textIssues(field: string, value: string, minimum: number, maximum: number) {
  const issues: SkillValidationIssue[] = [];
  if (value.length < minimum || value.length > maximum) {
    issues.push({ field, code: "length_invalid", message: `${field} must be between ${minimum} and ${maximum} characters.` });
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || hiddenControlPattern.test(value)) {
    issues.push({ field, code: "hidden_content_not_allowed", message: `${field} contains hidden or unsupported control characters.` });
  }
  for (const rule of unsupportedContentPatterns) {
    if (rule.pattern.test(value)) {
      issues.push({ field, code: rule.code, message: `${field} contains content that customer-authored skills cannot use.` });
    }
  }
  return issues;
}

function normalizedStringArray(value: unknown, maximumItems: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(asString).filter(Boolean))].slice(0, maximumItems + 1);
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

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stable(value), "utf8").digest("hex")}`;
}

function references(value: unknown, issues: SkillValidationIssue[]) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) {
    issues.push({ field: "references", code: "references_invalid", message: "Use no more than ten approved organization references." });
    return [];
  }
  return value.flatMap((item, index): OrganizationSkillReferenceInput[] => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const reference_type = asString(record.reference_type);
    const reference_key = asString(record.reference_key).toLowerCase();
    const title = asString(record.title);
    const language = asString(record.language) || "und";
    const provenance = asString(record.provenance);
    const expiresRaw = asString(record.expires_at);
    const field = `references.${index}`;
    if (!["knowledge_collection", "approved_document", "approved_asset"].includes(reference_type)
      || !referenceKeyPattern.test(reference_key) || reference_key.includes("..")
      || !["en", "ar", "und"].includes(language)) {
      issues.push({ field, code: "reference_invalid", message: "Reference type, organization key, or language is unsupported." });
      return [];
    }
    issues.push(...textIssues(`${field}.title`, title, 3, 200));
    issues.push(...textIssues(`${field}.provenance`, provenance, 3, 500));
    let expires_at: string | null = null;
    if (expiresRaw) {
      const expires = new Date(expiresRaw);
      if (Number.isNaN(expires.valueOf())) {
        issues.push({ field: `${field}.expires_at`, code: "date_invalid", message: "Reference expiry must be a valid date." });
      } else if (expires.valueOf() <= Date.now()) {
        issues.push({ field: `${field}.expires_at`, code: "reference_expired", message: "Expired references cannot be attached to a new skill version." });
      } else {
        expires_at = expires.toISOString();
      }
    }
    return [{
      reference_type: reference_type as OrganizationSkillReferenceInput["reference_type"],
      reference_key,
      title,
      language: language as OrganizationSkillReferenceInput["language"],
      provenance,
      expires_at,
      content_hash: sha256({ reference_key, title, language, provenance, expires_at }),
    }];
  });
}

export function parseOrganizationSkillDraft(body: unknown): OrganizationSkillDraftInput {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const issues: SkillValidationIssue[] = [];
  const code = asString(record.code).toLowerCase();
  const skill_class = asString(record.skill_class);
  const display_name = asString(record.display_name);
  const description = asString(record.description);
  const activation_guidance = asString(record.activation_guidance);
  const instructions = asString(record.instructions);
  const escalation_conditions = asString(record.escalation_conditions);
  const examples = normalizedStringArray(record.examples, 10);
  const expected_inputs = normalizedStringArray(record.expected_inputs, 20).map((item) => item.toLowerCase());
  const expected_outputs = normalizedStringArray(record.expected_outputs, 20).map((item) => item.toLowerCase());
  const languages = normalizedStringArray(record.languages, 2);
  const cloneSource = asString(record.clone_source_version_id);

  if (!/^[a-z][a-z0-9_]{2,79}$/.test(code)) {
    issues.push({ field: "code", code: "code_invalid", message: "Code must use lowercase letters, numbers, and underscores." });
  }
  if (!["knowledge", "proposal_instruction"].includes(skill_class)) {
    issues.push({ field: "skill_class", code: "class_invalid", message: "Customer skills may only be knowledge or proposal instruction skills." });
  }
  issues.push(...textIssues("display_name", display_name, 3, 120));
  issues.push(...textIssues("description", description, 20, 1000));
  issues.push(...textIssues("activation_guidance", activation_guidance, 20, 2000));
  issues.push(...textIssues("instructions", instructions, 20, 12000));
  issues.push(...textIssues("escalation_conditions", escalation_conditions, 10, 3000));
  if (examples.length > 10) issues.push({ field: "examples", code: "too_many", message: "Use no more than ten examples." });
  examples.forEach((example, index) => issues.push(...textIssues(`examples.${index}`, example, 1, 1000)));
  for (const [field, values] of [["expected_inputs", expected_inputs], ["expected_outputs", expected_outputs]] as const) {
    if (!values.length || values.length > 20 || values.some((item) => !tokenPattern.test(item))) {
      issues.push({ field, code: "contract_invalid", message: `${field} requires 1–20 safe contract tokens.` });
    }
  }
  if (!languages.length || languages.length > 2 || languages.some((language) => !["en", "ar"].includes(language))) {
    issues.push({ field: "languages", code: "languages_invalid", message: "Select English, Arabic, or both." });
  }
  if (cloneSource && !uuidPattern.test(cloneSource)) {
    issues.push({ field: "clone_source_version_id", code: "clone_source_invalid", message: "Clone source is invalid." });
  }
  const normalizedReferences = references(record.references, issues);
  if (issues.length) throw new SkillLibraryValidationError(issues);

  const content = {
    code,
    skill_class: skill_class as OrganizationSkillClass,
    display_name,
    description,
    activation_guidance,
    instructions,
    examples,
    expected_inputs,
    expected_outputs,
    escalation_conditions,
    languages: languages as SkillLanguage[],
    references: normalizedReferences,
  };
  return {
    ...content,
    clone_source_version_id: cloneSource || null,
    content_hash: sha256(content),
  };
}

export function validationReport(input: OrganizationSkillDraftInput) {
  return {
    valid: true,
    validator_version: "tanaghom.organization-skill.v1",
    content_hash: input.content_hash,
    checked_boundaries: [
      "non_executable_class",
      "no_embedded_secrets",
      "no_arbitrary_urls",
      "no_hidden_instructions",
      "no_runtime_identifiers",
      "bounded_content",
      "approved_reference_keys",
      "portable_contract",
    ],
  };
}

export function portableSkillMarkdown(input: {
  code: string;
  skill_class: string;
  display_name: string;
  description: string;
  activation_guidance: string;
  instructions: string;
  examples: string[];
  expected_inputs: string[];
  expected_outputs: string[];
  escalation_conditions: string;
  languages: string[];
  content_hash: string;
  version_number: number;
}) {
  const quoted = (value: string) => JSON.stringify(value);
  const list = (values: string[]) => values.length ? values.map((value) => `- ${value}`).join("\n") : "- None";
  return [
    "---",
    `name: ${quoted(input.code.replaceAll("_", "-"))}`,
    `description: ${quoted(input.description)}`,
    "metadata:",
    `  tanaghom_class: ${quoted(input.skill_class)}`,
    `  tanaghom_version: ${input.version_number}`,
    `  content_hash: ${quoted(input.content_hash)}`,
    `  languages: [${input.languages.map(quoted).join(", ")}]`,
    "---",
    "",
    `# ${input.display_name}`,
    "",
    "## When to use",
    "",
    input.activation_guidance,
    "",
    "## Instructions",
    "",
    input.instructions,
    "",
    "## Expected inputs",
    "",
    list(input.expected_inputs),
    "",
    "## Expected outputs",
    "",
    list(input.expected_outputs),
    "",
    "## Escalate when",
    "",
    input.escalation_conditions,
    "",
    "## Examples",
    "",
    list(input.examples),
    "",
    "> This exported skill is instruction-only. It contains no executable tools, credentials, URLs, or runtime bindings.",
    "",
  ].join("\n");
}
