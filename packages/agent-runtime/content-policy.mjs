import { createHash } from 'node:crypto';

export const CONTENT_POLICY_VERSION = 'tanaghom.communication-content-policy.v1';
export const CONTENT_POLICY_CANONICALIZATION_VERSION = 'tanaghom.canonical-json.v1';
export const CONTENT_POLICY_LAYER = 'L1_content';
export const CONTENT_POLICY_REMAINING_LAYERS = Object.freeze(['L2', 'L3', 'L4', 'L5', 'L6']);

export const CONTENT_HARD_INPUT_LIMITS = Object.freeze({
  subject_bytes: 4096,
  body_bytes: 262144,
});

const DEFAULT_BANNED_PHRASES = Object.freeze([
  'as an ai',
  'as a language model',
  'i hope this finds you well',
  "in today's fast-paced world",
  'exclusive deal',
  'special offer',
  'limited time offer',
  'act now',
  'click here',
  'risk-free',
  'guaranteed results',
  'no obligation',
  'make money fast',
  'double your income',
  'congratulations',
  'winner',
  'أنا مساعد ذكاء اصطناعي',
  'كذكاء اصطناعي',
  'في عالم اليوم سريع الخطى',
  'أتمنى أن تجد هذه الرسالة',
  'عرض حصري',
  'عرض خاص',
  'عرض محدود',
  'فرصة لا تعوض',
  'اضغط هنا',
  'سارع الآن',
  'بدون أي مخاطر',
  'نتائج مضمونة',
  'بدون التزام',
]);

export const DEFAULT_CONTENT_POLICY = Object.freeze({
  policy_version: CONTENT_POLICY_VERSION,
  max_subject_characters: 90,
  max_body_words: 220,
  max_links: 1,
  banned_phrases: DEFAULT_BANNED_PHRASES,
});

const SUPPORTED_POLICY_KEYS = Object.freeze([
  'policy_version',
  'max_subject_characters',
  'max_body_words',
  'max_links',
  'banned_phrases',
]);

const HIDDEN_CONTROL_CODE_POINTS = new Set([
  0x00ad, 0x200b, 0x200c, 0x200d, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);

const DIRECTIONAL_MARKS = new Set([0x061c, 0x200e, 0x200f]);

const COMBINING_MARK_PATTERN = /\p{M}/gu;
const COMBINING_MARK_CHARACTER = /\p{M}/u;
const COMPARISON_SEPARATOR_PATTERN = /[.,!?;:،؛؟"'«»()\[\]{}<>…—–\-_*\/\\|+=~^&@#%]/gu;
const PLACEHOLDER_TOKEN_PATTERN = /^[\p{L}\p{N}_.\-\s]{1,64}$/u;

const MAX_CONSECUTIVE_COMBINING_MARKS = 16;
const MAX_PLACEHOLDER_TOKEN_LENGTH = 64;
const MAX_PLACEHOLDER_FINDINGS = 3;
const MAX_HTML_TAG_LENGTH = 200;
const MAX_DIAGNOSTICS = 8;
const MAX_DIAGNOSTIC_DETAIL_LENGTH = 120;
const MAX_BANNED_PHRASE_FINDINGS = 3;
const MAX_BANNED_PHRASES = 200;
const MAX_BANNED_PHRASE_LENGTH = 200;

const CHECKED_RULES = Object.freeze([
  'input_bounds',
  'combining_mark_runs',
  'subject_presence',
  'body_presence',
  'subject_length',
  'body_length',
  'merge_variables',
  'placeholders',
  'links',
  'html',
  'hidden_characters',
  'banned_phrases',
]);

function truncate(value, limit) {
  if (value.length <= limit) return value;
  return value.slice(0, Math.max(0, limit - 3)) + '...';
}

function addReason(reasons, code) {
  if (!reasons.includes(code)) reasons.push(code);
}

function guardedNormalizeForComparison(value) {
  if (findExcessiveCombiningMarkRun(value) > 0) return value;
  return value.normalize('NFC');
}

function comparisonRepresentation(value, modes) {
  const removeDirectionalMarks = modes !== undefined && modes.directional_marks === 'remove';
  const normalized = guardedNormalizeForComparison(value).replace(COMBINING_MARK_PATTERN, '');
  let unfolded = '';
  for (const character of normalized) {
    const code = character.codePointAt(0);
    if (code === 0x0640) continue;
    if (code >= 0x0660 && code <= 0x0669) {
      unfolded += String.fromCharCode(48 + code - 0x0660);
      continue;
    }
    if (code >= 0x06f0 && code <= 0x06f9) {
      unfolded += String.fromCharCode(48 + code - 0x06f0);
      continue;
    }
    if (HIDDEN_CONTROL_CODE_POINTS.has(code)) continue;
    if (DIRECTIONAL_MARKS.has(code)) {
      if (!removeDirectionalMarks) unfolded += ' ';
      continue;
    }
    unfolded += character;
  }
  return unfolded
    .toLowerCase()
    .replace(COMPARISON_SEPARATOR_PATTERN, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function findExcessiveCombiningMarkRun(text) {
  let run = 0;
  for (const character of text) {
    if (COMBINING_MARK_CHARACTER.test(character)) {
      run += 1;
      if (run > MAX_CONSECUTIVE_COMBINING_MARKS) return run;
    } else {
      run = 0;
    }
  }
  return 0;
}

function countCodePoints(value) {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}

function countWords(comparisonText) {
  if (comparisonText.length === 0) return 0;
  return comparisonText.split(' ').length;
}

function countLinks(body) {
  const lowered = body.toLowerCase();
  let count = 0;
  let index = 0;
  while (index < lowered.length) {
    const next = lowered.indexOf('http', index);
    if (next === -1) break;
    if (lowered.startsWith('://', next + 4) || lowered.startsWith('s://', next + 4)) count += 1;
    index = next + 4;
  }
  return count;
}

function findHtmlTag(text) {
  const length = text.length;
  let index = 0;
  while (index < length) {
    const open = text.indexOf('<', index);
    if (open === -1) return null;
    const next = text.charAt(open + 1);
    if (/[A-Za-z/]/.test(next)) {
      const stop = Math.min(length, open + 2 + MAX_HTML_TAG_LENGTH);
      let cursor = open + 2;
      let closedAt = -1;
      while (cursor < stop) {
        const code = text.charCodeAt(cursor);
        if (code === 62) {
          closedAt = cursor;
          break;
        }
        if (code === 60) break;
        cursor += 1;
      }
      if (closedAt !== -1) return truncate(text.slice(open, closedAt + 1), 80);
    }
    index = open + 1;
  }
  return null;
}

function findHiddenControlCharacters(text) {
  const found = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index);
    if (code > 0xffff) index += 1;
    if (HIDDEN_CONTROL_CODE_POINTS.has(code)) {
      found.push('U+' + code.toString(16).toUpperCase().padStart(4, '0'));
      if (found.length >= 3) break;
    }
  }
  return found;
}

function scanPlaceholders(text, field, unresolved, malformed) {
  const length = text.length;
  let index = 0;
  while (index < length) {
    if (unresolved.length >= MAX_PLACEHOLDER_FINDINGS && malformed.length >= MAX_PLACEHOLDER_FINDINGS) return;
    const open = text.indexOf('{', index);
    if (open === -1) return;
    const isDoubleOpen = text.charAt(open + 1) === '{';
    const contentStart = isDoubleOpen ? open + 2 : open + 1;
    const stop = Math.min(length, contentStart + MAX_PLACEHOLDER_TOKEN_LENGTH + 1);
    let cursor = contentStart;
    let token = '';
    let closedAt = -1;
    let nestedAt = -1;
    while (cursor < stop) {
      const character = text.charAt(cursor);
      if (character === '}') {
        closedAt = cursor;
        break;
      }
      if (character === '{' || character === '\n' || character === '\r' || character === '\t') {
        nestedAt = cursor;
        break;
      }
      token += character;
      cursor += 1;
    }
    if (closedAt === -1) {
      if (malformed.length < MAX_PLACEHOLDER_FINDINGS) {
        malformed.push({
          code: 'malformed_placeholder',
          field,
          detail: truncate(text.slice(open, Math.min(length, open + 24)), 40),
        });
      }
      if (nestedAt === -1) {
        index = open + 1;
      } else if (text.charAt(nestedAt) === '{') {
        index = nestedAt;
      } else {
        index = nestedAt + 1;
      }
      continue;
    }
    const tokenTrimmed = token.trim();
    const tokenValid = tokenTrimmed.length > 0 && PLACEHOLDER_TOKEN_PATTERN.test(tokenTrimmed);
    const closedDouble = text.charAt(closedAt + 1) === '}';
    if (isDoubleOpen) {
      if (tokenValid && closedDouble) {
        if (unresolved.length < MAX_PLACEHOLDER_FINDINGS) {
          unresolved.push({
            code: 'unresolved_merge_variable',
            field,
            detail: truncate('{{' + tokenTrimmed + '}}', 70),
          });
        }
        index = closedAt + 2;
      } else {
        if (malformed.length < MAX_PLACEHOLDER_FINDINGS) {
          malformed.push({
            code: 'malformed_placeholder',
            field,
            detail: truncate(text.slice(open, Math.min(length, closedAt + 2)), 40),
          });
        }
        index = closedDouble ? closedAt + 2 : closedAt + 1;
      }
      continue;
    }
    if (closedDouble) {
      if (malformed.length < MAX_PLACEHOLDER_FINDINGS) {
        malformed.push({
          code: 'malformed_placeholder',
          field,
          detail: truncate(text.slice(open, Math.min(length, closedAt + 2)), 40),
        });
      }
      index = closedAt + 2;
      continue;
    }
    if (tokenValid) {
      if (unresolved.length < MAX_PLACEHOLDER_FINDINGS) {
        unresolved.push({
          code: 'unresolved_merge_variable',
          field,
          detail: truncate('{' + tokenTrimmed + '}', 70),
        });
      }
      index = closedAt + 1;
      continue;
    }
    if (malformed.length < MAX_PLACEHOLDER_FINDINGS) {
      malformed.push({
        code: 'malformed_placeholder',
        field,
        detail: truncate(text.slice(open, Math.min(length, closedAt + 1)), 40),
      });
    }
    index = closedAt + 1;
  }
}

function findBannedPhrases(policyPhrases, text) {
  const haystack = ' ' + comparisonRepresentation(text) + ' ';
  const hasDirectionalMarks = /[\u061c\u200e\u200f]/u.test(text);
  const markRemovedHaystack = hasDirectionalMarks ? ' ' + comparisonRepresentation(text, { directional_marks: 'remove' }) + ' ' : haystack;
  const matches = [];
  for (const phrase of policyPhrases) {
    if (matches.length >= MAX_BANNED_PHRASE_FINDINGS) break;
    const needle = ' ' + comparisonRepresentation(phrase) + ' ';
    if (needle.length > 2 && (haystack.includes(needle) || markRemovedHaystack.includes(needle))) matches.push(phrase);
  }
  return matches;
}

function contentFingerprint(policyVersion, subject, body) {
  const canonical = JSON.stringify({
    body,
    canonicalization_version: CONTENT_POLICY_CANONICALIZATION_VERSION,
    policy_version: policyVersion,
    subject,
  });
  return 'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function resolvePolicy(overrides) {
  if (overrides === undefined || overrides === null) return DEFAULT_CONTENT_POLICY;
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('content policy overrides must be an object');
  }
  for (const key of Object.keys(overrides)) {
    if (!SUPPORTED_POLICY_KEYS.includes(key)) {
      throw new TypeError('unsupported content policy field: ' + key);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(overrides, 'policy_version')) {
    throw new TypeError('content policy overrides must declare policy_version');
  }
  const policy = { ...DEFAULT_CONTENT_POLICY, ...overrides };
  if (typeof policy.policy_version !== 'string' || policy.policy_version.length === 0 || policy.policy_version.length > 120) {
    throw new TypeError('content policy policy_version must be a non-empty string of at most 120 characters');
  }
  for (const numericKey of ['max_subject_characters', 'max_body_words', 'max_links']) {
    const value = policy[numericKey];
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError('content policy ' + numericKey + ' must be a non-negative integer');
    }
  }
  if (!Array.isArray(policy.banned_phrases) || policy.banned_phrases.length > MAX_BANNED_PHRASES) {
    throw new TypeError('content policy banned_phrases must be an array of at most ' + MAX_BANNED_PHRASES + ' phrases');
  }
  for (const phrase of policy.banned_phrases) {
    if (typeof phrase !== 'string' || phrase.length === 0 || phrase.length > MAX_BANNED_PHRASE_LENGTH) {
      throw new TypeError('content policy banned phrases must be non-empty strings of at most ' + MAX_BANNED_PHRASE_LENGTH + ' characters');
    }
  }
  return Object.freeze({ ...policy, banned_phrases: Object.freeze([...policy.banned_phrases]) });
}

function buildResult(policy, reasons, diagnostics, fingerprint, checkedRules, inputBytes) {
  return Object.freeze({
    layer: CONTENT_POLICY_LAYER,
    content_validation_passed: reasons.length === 0,
    policy_version: policy.policy_version,
    canonicalization_version: CONTENT_POLICY_CANONICALIZATION_VERSION,
    reason_codes: Object.freeze([...reasons]),
    diagnostics: Object.freeze(
      diagnostics.slice(0, MAX_DIAGNOSTICS).map((diagnostic) => Object.freeze({
        code: diagnostic.code,
        field: diagnostic.field,
        detail: truncate(diagnostic.detail, MAX_DIAGNOSTIC_DETAIL_LENGTH),
      })),
    ),
    content_fingerprint: fingerprint,
    checked_rules: Object.freeze([...checkedRules]),
    input_bytes: Object.freeze({ ...inputBytes }),
    remaining_layers: CONTENT_POLICY_REMAINING_LAYERS,
  });
}

export function normalizeContentForComparison(value) {
  if (typeof value !== 'string') {
    throw new TypeError('content comparison input must be a string');
  }
  if (Buffer.byteLength(value, 'utf8') > CONTENT_HARD_INPUT_LIMITS.body_bytes) {
    throw new RangeError('content comparison input exceeds the ' + CONTENT_HARD_INPUT_LIMITS.body_bytes + ' byte hard limit');
  }
  return comparisonRepresentation(value);
}

export function validateCommunicationContent(candidate, options) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('communication content candidate must be an object with subject and body strings');
  }
  const { subject, body } = candidate;
  if (typeof subject !== 'string' || typeof body !== 'string') {
    throw new TypeError('communication content candidate subject and body must be strings');
  }
  if (options !== undefined && options !== null && (typeof options !== 'object' || Array.isArray(options))) {
    throw new TypeError('content validation options must be an object');
  }
  const policy = resolvePolicy(options === undefined || options === null ? undefined : options.policy);
  const inputBytes = { subject: Buffer.byteLength(subject, 'utf8'), body: Buffer.byteLength(body, 'utf8') };
  const reasons = [];
  const diagnostics = [];

  if (inputBytes.subject > CONTENT_HARD_INPUT_LIMITS.subject_bytes || inputBytes.body > CONTENT_HARD_INPUT_LIMITS.body_bytes) {
    for (const field of ['subject', 'body']) {
      const limit = field === 'subject' ? CONTENT_HARD_INPUT_LIMITS.subject_bytes : CONTENT_HARD_INPUT_LIMITS.body_bytes;
      if (inputBytes[field] > limit) {
        addReason(reasons, 'content_too_large');
        diagnostics.push({
          code: 'content_too_large',
          field,
          detail: inputBytes[field] + ' utf8 bytes exceeds the ' + limit + ' byte hard limit',
        });
      }
    }
    return buildResult(policy, reasons, diagnostics, null, ['input_bounds'], inputBytes);
  }

  const fingerprint = contentFingerprint(policy.policy_version, subject, body);

  const subjectMarkRun = findExcessiveCombiningMarkRun(subject);
  const bodyMarkRun = findExcessiveCombiningMarkRun(body);
  if (subjectMarkRun > 0 || bodyMarkRun > 0) {
    addReason(reasons, 'excessive_combining_marks');
    if (subjectMarkRun > 0) {
      diagnostics.push({
        code: 'excessive_combining_marks',
        field: 'subject',
        detail: subjectMarkRun + ' consecutive combining marks exceeds the ' + MAX_CONSECUTIVE_COMBINING_MARKS + ' limit',
      });
    }
    if (bodyMarkRun > 0) {
      diagnostics.push({
        code: 'excessive_combining_marks',
        field: 'body',
        detail: bodyMarkRun + ' consecutive combining marks exceeds the ' + MAX_CONSECUTIVE_COMBINING_MARKS + ' limit',
      });
    }
    return buildResult(policy, reasons, diagnostics, fingerprint, ['input_bounds', 'combining_mark_runs'], inputBytes);
  }

  const subjectComparison = comparisonRepresentation(subject);
  const bodyComparison = comparisonRepresentation(body);

  if (subjectComparison.length === 0) {
    addReason(reasons, 'empty_subject');
    diagnostics.push({ code: 'empty_subject', field: 'subject', detail: 'subject contains no visible text' });
  }
  if (bodyComparison.length === 0) {
    addReason(reasons, 'empty_body');
    diagnostics.push({ code: 'empty_body', field: 'body', detail: 'body contains no visible text' });
  }

  const subjectCodePoints = countCodePoints(subject);
  if (subjectCodePoints > policy.max_subject_characters) {
    addReason(reasons, 'subject_too_long');
    diagnostics.push({
      code: 'subject_too_long',
      field: 'subject',
      detail: subjectCodePoints + ' code points exceeds the ' + policy.max_subject_characters + ' limit',
    });
  }

  const bodyWordCount = countWords(bodyComparison);
  if (bodyWordCount > policy.max_body_words) {
    addReason(reasons, 'body_too_long');
    diagnostics.push({
      code: 'body_too_long',
      field: 'body',
      detail: bodyWordCount + ' words exceeds the ' + policy.max_body_words + ' limit',
    });
  }

  const unresolved = [];
  const malformed = [];
  scanPlaceholders(subject, 'subject', unresolved, malformed);
  scanPlaceholders(body, 'body', unresolved, malformed);
  if (unresolved.length > 0) addReason(reasons, 'unresolved_merge_variable');
  diagnostics.push(...unresolved);
  if (malformed.length > 0) addReason(reasons, 'malformed_placeholder');
  diagnostics.push(...malformed);

  const linkCount = countLinks(body);
  if (linkCount > policy.max_links) {
    addReason(reasons, 'too_many_links');
    diagnostics.push({
      code: 'too_many_links',
      field: 'body',
      detail: linkCount + ' links exceeds the ' + policy.max_links + ' link limit',
    });
  }

  for (const field of ['subject', 'body']) {
    const html = findHtmlTag(field === 'subject' ? subject : body);
    if (html !== null) {
      addReason(reasons, 'unsupported_html');
      diagnostics.push({ code: 'unsupported_html', field, detail: html });
    }
  }

  for (const field of ['subject', 'body']) {
    const found = findHiddenControlCharacters(field === 'subject' ? subject : body);
    if (found.length > 0) {
      addReason(reasons, 'hidden_control_characters');
      diagnostics.push({ code: 'hidden_control_characters', field, detail: found.join(', ') });
    }
  }

  for (const field of ['subject', 'body']) {
    const matches = findBannedPhrases(policy.banned_phrases, field === 'subject' ? subject : body);
    if (matches.length > 0) {
      addReason(reasons, 'banned_phrase');
      diagnostics.push({ code: 'banned_phrase', field, detail: truncate(matches.join(', '), MAX_DIAGNOSTIC_DETAIL_LENGTH) });
    }
  }

  return buildResult(policy, reasons, diagnostics, fingerprint, CHECKED_RULES, inputBytes);
}
