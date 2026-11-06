import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTENT_HARD_INPUT_LIMITS,
  CONTENT_POLICY_CANONICALIZATION_VERSION,
  CONTENT_POLICY_LAYER,
  CONTENT_POLICY_REMAINING_LAYERS,
  CONTENT_POLICY_VERSION,
  DEFAULT_CONTENT_POLICY,
  normalizeContentForComparison,
  validateCommunicationContent,
} from '../packages/agent-runtime/content-policy.mjs';

const VALID_EN_SUBJECT = 'Quick follow-up on the Q3 report';
const VALID_EN_BODY =
  'Hi Sarah, we wrapped up the summary you asked for. It covers the three points from Tuesday. Would a short call on Sunday work?';
const VALID_AR_SUBJECT = 'متابعة اجتماع الربع الأخير';
const VALID_AR_BODY =
  'مرحباً سارة، أعددنا ملخصاً موجزاً عن نتائج الربع الأخير ونرفقه خلال يومين. هل يناسبك اجتماع قصير يوم الأحد؟';
const VALID_MIXED_SUBJECT = 'تأكيد الاجتماع — Q3 review';
const VALID_MIXED_BODY =
  'مرحباً Sarah، تم تأكيد الاجتماع يوم الأحد الساعة ١٠ صباحاً. سأرسل جدول الأعمال قبلها.';

function validate(subject, body, options) {
  return validateCommunicationContent({ subject, body }, options);
}

test('valid English draft passes every v1 rule with a verifiable fingerprint', () => {
  const result = validate(VALID_EN_SUBJECT, VALID_EN_BODY);
  assert.equal(result.content_validation_passed, true);
  assert.deepEqual(result.reason_codes, []);
  assert.equal(result.layer, CONTENT_POLICY_LAYER);
  assert.equal(result.policy_version, CONTENT_POLICY_VERSION);
  assert.equal(result.canonicalization_version, CONTENT_POLICY_CANONICALIZATION_VERSION);
  assert.match(result.content_fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.checked_rules.length, 12);
  assert.deepEqual(result.checked_rules, [
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
  assert.deepEqual(result.remaining_layers, ['L2', 'L3', 'L4', 'L5', 'L6']);
  assert.equal(result.input_bytes.subject > 0, true);
  assert.equal(result.input_bytes.body > 0, true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.reason_codes), true);
  assert.equal(Object.isFrozen(DEFAULT_CONTENT_POLICY), true);
});

test('valid Arabic draft passes with RTL mark, Arabic punctuation and Arabic-Indic digits intact', () => {
  const subject = '\u200F' + VALID_AR_SUBJECT;
  const body = VALID_AR_BODY;
  const candidate = Object.freeze({ subject, body });
  const result = validateCommunicationContent(candidate);
  assert.equal(result.content_validation_passed, true);
  assert.deepEqual(result.reason_codes, []);
  assert.equal(candidate.subject, subject);
  assert.equal(candidate.body, body);
});

test('mixed Arabic and English draft passes', () => {
  const result = validate(VALID_MIXED_SUBJECT, VALID_MIXED_BODY);
  assert.equal(result.content_validation_passed, true);
  assert.deepEqual(result.reason_codes, []);
});

test('empty subject fails with empty_subject', () => {
  const result = validate('', VALID_EN_BODY);
  assert.equal(result.content_validation_passed, false);
  assert.deepEqual(result.reason_codes, ['empty_subject']);
  assert.equal(result.diagnostics[0].field, 'subject');
});

test('whitespace-only subject fails as empty', () => {
  const result = validate('   \n\t  ', VALID_EN_BODY);
  assert.deepEqual(result.reason_codes, ['empty_subject']);
});

test('combining-marks-only subject fails as empty', () => {
  const result = validate('\u064B\u0651\u064C', VALID_EN_BODY);
  assert.deepEqual(result.reason_codes, ['empty_subject']);
});

test('empty body fails with empty_body', () => {
  const result = validate(VALID_EN_SUBJECT, '');
  assert.equal(result.content_validation_passed, false);
  assert.deepEqual(result.reason_codes, ['empty_body']);
});

test('subject of exactly 90 code points passes while 91 fails', () => {
  const ok = validate('ا'.repeat(90), VALID_AR_BODY);
  assert.deepEqual(ok.reason_codes, []);
  const tooLong = validate('ا'.repeat(91), VALID_AR_BODY);
  assert.deepEqual(tooLong.reason_codes, ['subject_too_long']);
  assert.match(tooLong.diagnostics[0].detail, /91 code points/);
});

test('body of exactly 220 words passes while 221 fails', () => {
  const ok = validate(VALID_AR_SUBJECT, Array(220).fill('كلمة').join(' '));
  assert.deepEqual(ok.reason_codes, []);
  const tooLong = validate(VALID_AR_SUBJECT, Array(221).fill('كلمة').join(' '));
  assert.deepEqual(tooLong.reason_codes, ['body_too_long']);
});

test('double-brace merge variables are flagged as unresolved in English and Arabic', () => {
  const english = validate(VALID_EN_SUBJECT, 'Hello {{first_name}}, quick note.');
  assert.deepEqual(english.reason_codes, ['unresolved_merge_variable']);
  assert.match(english.diagnostics[0].detail, /\{\{first_name\}\}/);
  const arabic = validate('تأكيد {{اسم_العميل}}', VALID_AR_BODY);
  assert.deepEqual(arabic.reason_codes, ['unresolved_merge_variable']);
  assert.match(arabic.diagnostics[0].detail, /\{\{اسم_العميل\}\}/);
});

test('single-brace merge variables are flagged as unresolved', () => {
  const result = validate(VALID_EN_SUBJECT, 'Hi {first_name}, quick note.');
  assert.deepEqual(result.reason_codes, ['unresolved_merge_variable']);
});

test('malformed placeholder variants are rejected as malformed_placeholder', () => {
  for (const body of ['Hello {{name}', 'Hello {}', 'Hello {{}}', 'Hello {name}}']) {
    const result = validate(VALID_EN_SUBJECT, body);
    assert.equal(result.reason_codes.includes('malformed_placeholder'), true, body);
    assert.equal(result.reason_codes.includes('unresolved_merge_variable'), false, body);
  }
});

test('placeholder findings deduplicate the reason code while keeping per-finding diagnostics', () => {
  const result = validate('{{a}}{{b}}', VALID_EN_BODY);
  assert.deepEqual(result.reason_codes, ['unresolved_merge_variable']);
  assert.equal(result.diagnostics.length, 2);
});

test('two or more body links fail while a single link passes', () => {
  const twoLinks = validate(
    VALID_EN_SUBJECT,
    'See https://example.com/pricing and https://example.com/demo for details.',
  );
  assert.deepEqual(twoLinks.reason_codes, ['too_many_links']);
  const oneLink = validate(VALID_AR_SUBJECT, 'راجع التفاصيل على https://example.com/pricing');
  assert.deepEqual(oneLink.reason_codes, []);
  const singleScheme = validate(VALID_EN_SUBJECT, 'Source: HTTP://EXAMPLE.COM/REPORT plus notes.');
  assert.deepEqual(singleScheme.reason_codes, []);
});

test('HTML markup fails while literal angle brackets without tag syntax pass', () => {
  const html = validate(VALID_EN_SUBJECT, 'Please review <b>this</b> summary.');
  assert.deepEqual(html.reason_codes, ['unsupported_html']);
  const literal = validate(VALID_EN_SUBJECT, 'Use the < shortcut and 3 < 4 comparisons.');
  assert.deepEqual(literal.reason_codes, []);
  const emoticon = validate('شكراً سارة <3', VALID_AR_BODY);
  assert.deepEqual(emoticon.reason_codes, []);
});

test('default English banned phrases are detected including case variants', () => {
  const result = validate(VALID_EN_SUBJECT, 'ACT NOW! This exclusive deal will not last.');
  assert.deepEqual(result.reason_codes, ['banned_phrase']);
  assert.match(result.diagnostics[0].detail, /act now/);
});

test('Arabic banned phrases are detected including tatweel and harakat evasion', () => {
  const tatweel = validate(VALID_AR_SUBJECT, 'لدينا عـــرض حصري لك هذا الشهر.');
  assert.deepEqual(tatweel.reason_codes, ['banned_phrase']);
  assert.match(tatweel.diagnostics[0].detail, /عرض حصري/);
  const harakat = validate(VALID_AR_SUBJECT, 'لدينا عَرضٌ حَصريّ لك هذا الشهر.');
  assert.deepEqual(harakat.reason_codes, ['banned_phrase']);
});

test('legitimate English and Arabic sales copy does not trigger false positives', () => {
  const english = validate(
    'A congratulatory note',
    'We will contact you tomorrow; the update you requested is attached and free of charge.',
  );
  assert.deepEqual(english.reason_codes, []);
  const arabic = validate(
    'تحديث الطلب',
    'نقدم لكم نتائج واضحة خلال أسبوعين دون أي التزام عليكم، ونرحب بأسئلتكم.',
  );
  assert.deepEqual(arabic.reason_codes, []);
});

test('Unicode combining marks inside words are normalized for comparison, not rejected', () => {
  assert.equal(normalizeContentForComparison('e\u0301'), 'é');
  const result = validate('e\u0301tude de marché', VALID_AR_BODY);
  assert.deepEqual(result.reason_codes, []);
});

test('Arabic-Indic digits are preserved in the submission while comparison folds them to ASCII', () => {
  assert.equal(normalizeContentForComparison('٢٥٪'), '25٪');
  assert.equal(normalizeContentForComparison('۲۵'), '25');
  assert.equal(normalizeContentForComparison('السعر ١٢٣٤ ريال'), 'السعر 1234 ريال');
  const arabicIndic = validate(VALID_AR_SUBJECT, 'الخصم ٢٥٪ هذا الأسبوع فقط.');
  const ascii = validate(VALID_AR_SUBJECT, 'الخصم 25٪ هذا الأسبوع فقط.');
  assert.deepEqual(arabicIndic.reason_codes, []);
  assert.deepEqual(ascii.reason_codes, []);
  assert.notEqual(arabicIndic.content_fingerprint, ascii.content_fingerprint);
});

test('hidden control characters are rejected with code point diagnostics', () => {
  const zeroWidth = validate('مرحب\u200bا سارة', VALID_AR_BODY);
  assert.equal(zeroWidth.reason_codes.includes('hidden_control_characters'), true);
  assert.match(zeroWidth.diagnostics[0].detail, /U\+200B/);
  const bidiOverride = validate(VALID_EN_SUBJECT, 'Review \u202ethe attached file.');
  assert.equal(bidiOverride.reason_codes.includes('hidden_control_characters'), true);
  assert.match(bidiOverride.diagnostics[0].detail, /U\+202E/);
});

test('allowed directional marks do not trip the hidden character rule', () => {
  const result = validate('\u200F\u200E' + VALID_AR_SUBJECT + '\u061C', VALID_AR_BODY);
  assert.deepEqual(result.reason_codes, []);
});

test('directional marks inside banned phrases are treated as separators for matching', () => {
  const english = validate(VALID_EN_SUBJECT, 'Please act\u200Fnow to confirm.');
  assert.deepEqual(english.reason_codes, ['banned_phrase']);
  const arabic = validate(VALID_AR_SUBJECT, 'لدينا ع\u200Fرض حصري لك هذا الشهر.');
  assert.deepEqual(arabic.reason_codes, ['banned_phrase']);
});

test('separator substitution does not evade banned phrases', () => {
  for (const body of ['Please act-now.', 'Please act_now.', 'Please act*now.', 'Please act/now.']) {
    const result = validate(VALID_EN_SUBJECT, body);
    assert.deepEqual(result.reason_codes, ['banned_phrase'], body);
  }
});

test('excessive combining mark runs are rejected before normalization work', () => {
  const hostileBody = '\u0301\u0316'.repeat(65536);
  const first = validate(VALID_EN_SUBJECT, hostileBody);
  const second = validate(VALID_EN_SUBJECT, hostileBody);
  assert.deepEqual(first.reason_codes, ['excessive_combining_marks']);
  assert.notEqual(first.content_fingerprint, null);
  assert.deepEqual(first.checked_rules, ['input_bounds', 'combining_mark_runs']);
  assert.deepEqual(first, second);
  const seventeen = validate(VALID_EN_SUBJECT, 'a' + '\u0301'.repeat(17));
  assert.deepEqual(seventeen.reason_codes, ['excessive_combining_marks']);
  assert.equal(seventeen.diagnostics[0].field, 'body');
  const sixteen = validate(VALID_EN_SUBJECT, 'a' + '\u0301'.repeat(16));
  assert.deepEqual(sixteen.reason_codes, []);
});

test('the exported comparison helper is bounded and skips composition on pathological mark runs', () => {
  assert.equal(normalizeContentForComparison('\u0301\u0316'.repeat(65536)), '');
  assert.equal(normalizeContentForComparison('a' + '\u0301\u0316'.repeat(65535)), 'a');
  assert.throws(
    () => normalizeContentForComparison('x'.repeat(CONTENT_HARD_INPUT_LIMITS.body_bytes + 1)),
    RangeError,
  );
  assert.equal(normalizeContentForComparison('e\u0301'), 'é');
});

test('excessive payload fails fast under content_too_large without a fingerprint', () => {
  const oversized = 'x'.repeat(CONTENT_HARD_INPUT_LIMITS.body_bytes + 1);
  const result = validate(VALID_EN_SUBJECT, oversized);
  assert.deepEqual(result.reason_codes, ['content_too_large']);
  assert.equal(result.content_fingerprint, null);
  assert.deepEqual(result.checked_rules, ['input_bounds']);
  const oversizedSubject = validate('s'.repeat(CONTENT_HARD_INPUT_LIMITS.subject_bytes + 1), VALID_EN_BODY);
  assert.deepEqual(oversizedSubject.reason_codes, ['content_too_large']);
});

test('large adversarial input under the cap completes deterministically without pathological behavior', () => {
  const hostileTagged = '<a>'.repeat(60000);
  const first = validate(VALID_EN_SUBJECT, hostileTagged);
  const second = validate(VALID_EN_SUBJECT, hostileTagged);
  assert.equal(first.reason_codes.includes('unsupported_html'), true);
  assert.deepEqual(first, second);
  const hostileUnterminated = '<a'.repeat(100000);
  const third = validate(VALID_EN_SUBJECT, hostileUnterminated);
  const fourth = validate(VALID_EN_SUBJECT, hostileUnterminated);
  assert.deepEqual(third, fourth);
  assert.equal(third.reason_codes.includes('unsupported_html'), false);
});

test('repeated validation of identical input is byte-deterministic', () => {
  const first = validate(VALID_MIXED_SUBJECT, VALID_MIXED_BODY);
  const second = validate(VALID_MIXED_SUBJECT, VALID_MIXED_BODY);
  assert.deepEqual(first, second);
  assert.equal(first.content_fingerprint, second.content_fingerprint);
});

test('submitted input is never mutated', () => {
  const subject = 'موضوع بعـــنوان {{name}}\u200f';
  const body = VALID_AR_BODY;
  const candidate = Object.freeze({ subject, body });
  const result = validateCommunicationContent(candidate);
  assert.equal(candidate.subject, subject);
  assert.equal(candidate.body, body);
  assert.deepEqual(result.reason_codes, ['unresolved_merge_variable']);
  validateCommunicationContent(Object.freeze({ subject: VALID_EN_SUBJECT, body: VALID_EN_BODY }));
});

test('policy overrides that declare a new version change verdicts and fingerprint', () => {
  const strictPolicy = {
    ...DEFAULT_CONTENT_POLICY,
    policy_version: 'tanaghom.communication-content-policy.v1-test.2',
    max_subject_characters: 5,
  };
  const result = validate(VALID_EN_SUBJECT, VALID_EN_BODY, { policy: strictPolicy });
  assert.equal(result.policy_version, 'tanaghom.communication-content-policy.v1-test.2');
  assert.deepEqual(result.reason_codes, ['subject_too_long']);
  const baseline = validate(VALID_EN_SUBJECT, VALID_EN_BODY);
  assert.notEqual(result.content_fingerprint, baseline.content_fingerprint);
});

test('policy overrides without policy_version are rejected', () => {
  assert.throws(
    () => validate(VALID_EN_SUBJECT, VALID_EN_BODY, { policy: { max_subject_characters: 5 } }),
    /policy_version/,
  );
});

test('unsupported policy fields are rejected', () => {
  assert.throws(
    () => validate(VALID_EN_SUBJECT, VALID_EN_BODY, { policy: { policy_version: 'x', max_links_v2: 3 } }),
    /unsupported content policy field/,
  );
});

test('non-string subject or body is rejected as programmer error', () => {
  assert.throws(() => validateCommunicationContent({ subject: 5, body: '' }), TypeError);
  assert.throws(() => validateCommunicationContent(null), TypeError);
  assert.throws(() => validateCommunicationContent({ subject: 'a' }), TypeError);
});

test('custom banned phrase lists replace the defaults deterministically', () => {
  const customPolicy = {
    policy_version: 'tanaghom.communication-content-policy.v1-test.custom',
    banned_phrases: ['نداء أخير'],
  };
  const flagged = validate(VALID_AR_SUBJECT, 'هذا نداء أخير لك للمشاركة.', { policy: customPolicy });
  assert.deepEqual(flagged.reason_codes, ['banned_phrase']);
  const nowAllowed = validate(VALID_AR_SUBJECT, 'لدينا عرض حصري لك هذا الشهر.', { policy: customPolicy });
  assert.deepEqual(nowAllowed.reason_codes, []);
});

test('result shape exposes an L1 layer and remaining layers so a pass cannot be read as dispatch authorization', () => {
  const result = validate(VALID_EN_SUBJECT, VALID_EN_BODY);
  assert.equal(result.content_validation_passed, true);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      'canonicalization_version',
      'checked_rules',
      'content_fingerprint',
      'content_validation_passed',
      'diagnostics',
      'input_bytes',
      'layer',
      'policy_version',
      'reason_codes',
      'remaining_layers',
    ],
  );
  assert.equal('authorized_to_send' in result, false);
  assert.equal('dispatch_allowed' in result, false);
  assert.deepEqual(result.remaining_layers, CONTENT_POLICY_REMAINING_LAYERS);
});

test('diagnostics are bounded to eight entries', () => {
  const subject = '{{a}}{{b}}{{c}} <b>x</b>\u200b عرض حصري';
  const body = '{{d}}{{e}}{{f}} <i>y</i>\u202e عرض خاص';
  const result = validate(subject, body);
  assert.equal(result.diagnostics.length, 8);
});

test('reason code order is stable and deduplicated', () => {
  const result = validate('', 'a '.repeat(221) + 'http://x.co http://y.co');
  assert.deepEqual(result.reason_codes, ['empty_subject', 'body_too_long', 'too_many_links']);
});

test('the module imports only node:crypto and contains no transport, filesystem or secret access', () => {
  const source = readFileSync(new URL('../packages/agent-runtime/content-policy.mjs', import.meta.url), 'utf8');
  const importSpecifiers = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.deepEqual(importSpecifiers, ['node:crypto']);
  for (const forbidden of ['process.env', 'fetch(', 'XMLHttpRequest', 'child_process', 'node:fs', 'node:net', 'node:tls', 'node:dns', 'require(']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
