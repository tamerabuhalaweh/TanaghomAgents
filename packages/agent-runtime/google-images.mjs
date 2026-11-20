// Google Gemini image generation for AI Workspace post cards.
//
// The text workspace already calls the Google Generative Language API with the
// mounted gemini key. Image generation uses the same API surface, the same key,
// and the same provider: POST /v1beta/models/{model}:generateContent with an
// IMAGE response modality. No other image provider is involved.
import { createHash } from 'node:crypto';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.1-flash-image';
const FALLBACK_MODEL = 'gemini-2.5-flash-image';
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,80}$/;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_DETAIL_CHARS = 300;
const DEFAULT_TIMEOUT_MS = 45000;

export const POST_IMAGE_NO_TEXT_RULE =
  'Photorealistic commercial photography, clean composition, natural lighting. CRITICAL: Do NOT render any text, words, letters, Arabic script, English script, numbers, watermarks, captions, buttons, or logos anywhere inside the image. Pure visual photography only.';

const IMAGE_MIME = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);

export class GoogleImageError extends Error {
  constructor(code, status = 502, details = null) {
    super(code);
    this.name = 'GoogleImageError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.http_status = details?.http_status ?? null;
  }
}

function apiKey(value) {
  if (typeof value !== 'string') throw new GoogleImageError('model_unavailable', 503);
  const key = value.trim();
  if (key.length < 20 || key.length > 500 || /\s/.test(key)) {
    throw new GoogleImageError('model_unavailable', 503);
  }
  return key;
}

function modelResource(model) {
  if (typeof model !== 'string' || !MODEL_ID.test(model)) {
    throw new GoogleImageError('model_unavailable', 503);
  }
  return `models/${model}`;
}

function sanitizeDetail(value, secret = '') {
  let text = typeof value === 'string' ? value : '';
  if (secret) text = text.split(secret).join('[redacted]');
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL_CHARS);
}

/** Detects the real image format from its magic bytes; provider claims alone are not trusted. */
export function sniffImageMime(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function imageGenerateEndpoint(model, baseUrl = DEFAULT_BASE_URL) {
  return `${String(baseUrl).replace(/\/$/, '')}/${modelResource(model)}:generateContent`;
}

/** Extracts the first inline image from a generateContent response. */
export function extractInlineImage(payload, maxBytes = MAX_IMAGE_BYTES) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) throw new GoogleImageError('image_output_missing', 502);
  for (const part of parts) {
    const inline = part?.inlineData ?? part?.inline_data;
    if (!inline?.data || typeof inline.data !== 'string') continue;
    const bytes = Buffer.from(inline.data, 'base64');
    if (!bytes.length) continue;
    if (bytes.length > maxBytes) throw new GoogleImageError('image_too_large', 502);
    const declared = String(inline.mimeType ?? inline.mime_type ?? '').toLowerCase();
    const sniffed = sniffImageMime(bytes);
    if (!sniffed || !IMAGE_MIME.includes(sniffed)) throw new GoogleImageError('image_type_rejected', 502);
    if (declared && declared !== sniffed) throw new GoogleImageError('image_type_rejected', 502);
    return {
      bytes,
      mimeType: sniffed,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteSize: bytes.length,
    };
  }
  throw new GoogleImageError('image_output_missing', 502);
}

function usableText(value, limit) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

/**
 * Builds a content-specific, language-neutral prompt for one post.
 *
 * The post's own visual brief wins; when a draft has none, that post's headline
 * and body stand in. A bedroom post therefore asks for a bedroom scene and a
 * kitchen-tools post asks for a kitchen scene instead of one generic photo.
 */
export function buildPostImagePrompt({ post = {}, brandKit = null, campaign = null } = {}) {
  const index = Number.isInteger(post.index) && post.index > 0 ? post.index : 1;
  const brand = usableText(brandKit?.brand_name ?? brandKit?.name, 80);
  const colors = (brandKit?.colors ?? {});
  const primary = usableText(colors?.primary, 24);
  const accent = usableText(colors?.accent, 24);
  const tone = usableText(brandKit?.tone, 120);
  const visualBrief = usableText(post.visual_brief, 640);
  const headline = usableText(post.headline, 240);
  const body = usableText(post.body, 640);
  const campaignTitle = usableText(campaign?.title, 120);
  const campaignBrief = usableText(campaign?.brief, 400);

  const scene = visualBrief || [headline, body].filter(Boolean).join(' — ');
  const palette = [primary, accent].filter(Boolean).join(' and ');

  return [
    brand
      ? `Editorial commercial photograph for social post ${index} of a ${brand} campaign.`
      : `Editorial commercial photograph for social post ${index} of the campaign.`,
    scene ? `Scene to photograph: ${scene}` : '',
    visualBrief && headline ? `The post headline is: ${headline}` : '',
    body ? `Supporting context for the scene (never rendered as words): ${body}` : '',
    campaignTitle ? `Campaign: ${campaignTitle}.` : '',
    campaignBrief ? `Campaign context: ${campaignBrief}.` : '',
    palette ? `Brand palette reference: ${palette}.` : 'Brand palette reference: warm, neutral tones.',
    tone ? `Brand tone: ${tone}.` : '',
    'Photograph real objects and settings only, in portrait-friendly framing with clear negative space.',
    POST_IMAGE_NO_TEXT_RULE,
  ].filter(Boolean).join(' ');
}

const HEADING = /^\s{0,3}(#{1,4})\s+(.+)$/u;
const POST_HEADING = /(?:post|draft|منشور|مسودة)/iu;
const PLURAL_PACK_TITLE = /\b(?:posts|drafts)\b|مسودات|منشورات/iu;
const VISUAL_HEADING = /^\s{0,3}#{3,6}\s*(?:visual\s*(?:brief|direction)|(?:photo|image)\s*brief|توصيف\s*بصري|تصور\s*بصري|الوصف\s*البصري)\b/iu;
const VISUAL_LINE = /^\s*[*\-•]?\s*\*{0,2}(visual brief|visual direction|photo brief|image brief|توصيف بصري|تصور بصري|الوصف البصري)\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(.+)$/iu;
const FIELD_LINE = /^\s*[*\-•]?\s*\*{0,2}(opening|headline|hook|body|caption|text|الافتتاحية|العنوان|النص|المتن|المحتوى|محتوى)\s*(?:\([^)]*\))?\s*\*{0,2}\s*[:：]\s*\*{0,2}\s*(.*)$/iu;
const META_LINE = /^\s*[*\-•]?\s*\*{0,2}(channel|platform|format|hashtags?|cta|cta button|call to action|نداء الإجراء|دعوة لاتخاذ إجراء|دعوة إلى اتخاذ إجراء|القناة|المنصة|الهاشتاقات|هاشتاقات)\s*\*{0,2}\s*[:：]/iu;

function imageSectionLines(document) {
  const sections = [];
  let current = null;
  let postLevel = 0;
  for (const line of String(document || '').replace(/\r\n/g, '\n').split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2];
      const isPluralTitle = level === 1 && PLURAL_PACK_TITLE.test(title);
      if (!isPluralTitle && POST_HEADING.test(title)) {
        current = [];
        postLevel = level;
        sections.push(current);
        continue;
      }
      if (current && level <= postLevel) {
        current = null;
        postLevel = 0;
        continue;
      }
    }
    if (current) current.push(line);
  }
  const fallback = String(document || '').replace(/\r\n/g, '\n').split('\n');
  return sections.length ? sections : [fallback];
}

/** Extracts up to three per-post briefs from a Task 2 draft for image prompting. */
export function postImageBriefs(document, limit = 3) {
  const briefs = [];
  for (const lines of imageSectionLines(document)) {
    let visualBrief = '';
    let headline = '';
    let body = '';
    let inVisualHeading = false;
    const spare = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || /^[-=_]{3,}$/.test(trimmed) || /^\s*\|/.test(line)) continue;
      if (/^#{1,6}\s/.test(trimmed)) {
        inVisualHeading = VISUAL_HEADING.test(line);
        continue;
      }
      if (inVisualHeading) {
        visualBrief = visualBrief || usableText(trimmed.replace(/^[*\-•]\s*/, ''), 640);
        inVisualHeading = false;
        continue;
      }
      const visual = VISUAL_LINE.exec(line);
      if (visual) { visualBrief = visualBrief || usableText(visual[2], 640); continue; }
      if (META_LINE.test(line)) continue;
      const field = FIELD_LINE.exec(line);
      if (field) {
        const label = field[1].toLowerCase();
        const value = usableText(field[2], 640);
        if (!value) continue;
        if (!headline && ['opening', 'headline', 'hook', 'الافتتاحية', 'العنوان'].includes(label)) headline = value;
        else if (!body) body = value;
        else spare.push(value);
        continue;
      }
      spare.push(usableText(trimmed.replace(/^[*\-•]\s*/, ''), 640));
    }
    if (!headline) headline = spare.shift() || '';
    if (!body) body = spare.join(' ');
    if (!visualBrief && !headline && !body) continue;
    briefs.push({
      index: briefs.length + 1,
      visual_brief: visualBrief || null,
      headline: headline || null,
      body: body || null,
    });
    if (briefs.length === limit) break;
  }
  return briefs;
}

async function readBounded(response) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel?.().catch?.(() => {});
    throw new GoogleImageError('image_too_large', 502);
  }
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length > MAX_RESPONSE_BYTES) throw new GoogleImageError('image_too_large', 502);
  return raw;
}

async function upstreamError(response, secret) {
  let message = '';
  try { message = sanitizeDetail(await response.text(), secret); } catch { /* status is still evidence */ }
  return { http_status: response.status, upstream_error: message };
}

export function createGoogleImagesClient({
  apiKey: providedKey,
  baseUrl = DEFAULT_BASE_URL,
  model = process.env.GOOGLE_IMAGE_MODEL || DEFAULT_MODEL,
  fallbackModel = FALLBACK_MODEL,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = MAX_IMAGE_BYTES,
} = {}) {
  const key = apiKey(providedKey);
  if (typeof fetchImpl !== 'function') throw new GoogleImageError('model_unavailable', 503);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new GoogleImageError('model_unavailable', 503);
  }
  const primary = modelResource(model).slice('models/'.length);
  const secondary = MODEL_ID.test(fallbackModel) ? fallbackModel : FALLBACK_MODEL;

  async function call(candidate, prompt) {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    });
    let response;
    try {
      response = await fetchImpl(imageGenerateEndpoint(candidate, baseUrl), {
        method: 'POST',
        headers: { 'x-goog-api-key': key, accept: 'application/json', 'content-type': 'application/json' },
        body,
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new GoogleImageError('provider_error', 502, {
        error_name: typeof error?.name === 'string' ? error.name : 'Error',
        upstream_error: sanitizeDetail(error?.message, key),
      });
    }
    if (!response.ok) {
      const details = await upstreamError(response, key);
      if (response.status === 429) throw new GoogleImageError('provider_quota_exceeded', 429, details);
      if (response.status === 404) throw new GoogleImageError('model_unavailable', 404, details);
      throw new GoogleImageError('provider_error', 502, details);
    }
    let payload;
    try {
      payload = JSON.parse((await readBounded(response)).toString('utf8'));
    } catch (error) {
      if (error instanceof GoogleImageError) throw error;
      throw new GoogleImageError('image_output_missing', 502);
    }
    return extractInlineImage(payload, maxBytes);
  }

  async function generate(prompt, { model: override } = {}) {
    const text = typeof prompt === 'string' ? prompt.trim() : '';
    if (text.length < 20 || text.length > 8000) throw new GoogleImageError('prompt_invalid', 400);
    const candidate = MODEL_ID.test(override ?? '') ? override : primary;
    try {
      return { ...(await call(candidate, text)), model: candidate };
    } catch (error) {
      // A retired or unavailable default model falls back to the long-lived
      // Nano Banana model; every other failure is reported to the caller.
      if (candidate !== secondary && error?.code === 'model_unavailable') {
        return { ...(await call(secondary, text)), model: secondary };
      }
      throw error;
    }
  }

  return { generate, model: primary, fallbackModel: secondary };
}

export { DEFAULT_MODEL as DEFAULT_IMAGE_MODEL, FALLBACK_MODEL as FALLBACK_IMAGE_MODEL, MAX_IMAGE_BYTES };
