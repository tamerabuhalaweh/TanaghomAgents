export interface GoogleImageResult {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256: string;
  byteSize: number;
  model: string;
}
export interface GoogleImagePost {
  index?: number;
  headline?: string | null;
  body?: string | null;
  visual_brief?: string | null;
}
export interface GoogleImageBrandKit {
  name?: string | null;
  brand_name?: string | null;
  colors?: Record<string, unknown> | null;
  tone?: string | null;
}
export interface GoogleImageClient {
  readonly model: string;
  readonly fallbackModel: string;
  generate(prompt: string, options?: { model?: string }): Promise<GoogleImageResult>;
}
export declare class GoogleImageError extends Error {
  constructor(code: string, status?: number, details?: { error_name?: string; upstream_error?: string; http_status?: number } | null);
  code: string;
  status: number;
  details: { error_name?: string; upstream_error?: string; http_status?: number } | null;
  http_status: number | null;
}
export declare const POST_IMAGE_NO_TEXT_RULE: string;
export declare const DEFAULT_IMAGE_MODEL: string;
export declare const FALLBACK_IMAGE_MODEL: string;
export declare const MAX_IMAGE_BYTES: number;
export declare function sniffImageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null;
export declare function imageGenerateEndpoint(model: string, baseUrl?: string): string;
export declare function extractInlineImage(payload: unknown, maxBytes?: number): GoogleImageResult;
export declare function buildPostImagePrompt(input?: {
  post?: GoogleImagePost;
  brandKit?: GoogleImageBrandKit | null;
  campaign?: { title?: string | null; brief?: string | null } | null;
}): string;
export declare function postImageBriefs(document: string, limit?: number): Array<Required<Pick<GoogleImagePost, 'index'>> & GoogleImagePost>;
export declare function createGoogleImagesClient(options?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fallbackModel?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}): GoogleImageClient;
