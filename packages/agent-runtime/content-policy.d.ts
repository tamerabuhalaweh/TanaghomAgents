export type ContentPolicyReasonCode =
  | 'content_too_large'
  | 'excessive_combining_marks'
  | 'empty_subject'
  | 'empty_body'
  | 'subject_too_long'
  | 'body_too_long'
  | 'unresolved_merge_variable'
  | 'malformed_placeholder'
  | 'too_many_links'
  | 'unsupported_html'
  | 'hidden_control_characters'
  | 'banned_phrase';

export type ContentPolicyField = 'subject' | 'body';

export interface CommunicationContentPolicy {
  policy_version: string;
  max_subject_characters: number;
  max_body_words: number;
  max_links: number;
  banned_phrases: readonly string[];
}

export interface CommunicationContentCandidate {
  subject: string;
  body: string;
}

export interface ContentValidationOptions {
  policy?: Partial<CommunicationContentPolicy>;
}

export interface ContentValidationDiagnostic {
  code: ContentPolicyReasonCode;
  field: ContentPolicyField;
  detail: string;
}

export interface ContentValidationResult {
  layer: 'L1_content';
  content_validation_passed: boolean;
  policy_version: string;
  canonicalization_version: string;
  reason_codes: readonly ContentPolicyReasonCode[];
  diagnostics: readonly ContentValidationDiagnostic[];
  content_fingerprint: string | null;
  checked_rules: readonly string[];
  input_bytes: Readonly<{ subject: number; body: number }>;
  remaining_layers: readonly ['L2', 'L3', 'L4', 'L5', 'L6'];
}

export const CONTENT_POLICY_VERSION: 'tanaghom.communication-content-policy.v1';
export const CONTENT_POLICY_CANONICALIZATION_VERSION: 'tanaghom.canonical-json.v1';
export const CONTENT_POLICY_LAYER: 'L1_content';
export const CONTENT_POLICY_REMAINING_LAYERS: readonly ['L2', 'L3', 'L4', 'L5', 'L6'];
export const CONTENT_HARD_INPUT_LIMITS: Readonly<{ subject_bytes: number; body_bytes: number }>;
export const DEFAULT_CONTENT_POLICY: Readonly<CommunicationContentPolicy>;

export function normalizeContentForComparison(value: string): string;

export function validateCommunicationContent(
  candidate: CommunicationContentCandidate,
  options?: ContentValidationOptions,
): ContentValidationResult;
