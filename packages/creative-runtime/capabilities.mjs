// Creative capability/lane/state vocabulary. Single source for the P1a
// foundation; the database CHECK constraints are the enforcement mirror.
export const CAPABILITIES = Object.freeze([
  'image', 'edit', 'product_shoot', 'design', 'carousel', 'motion',
  'video', 'talking_head', 'voice', 'music', 'landing_page',
]);
export const LANES = Object.freeze(['cpu', 'gpu_image', 'gpu_video', 'gpu_audio']);
export const STATUSES = Object.freeze([
  'queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled', 'expired',
]);
export const TERMINAL_STATUSES = Object.freeze(['succeeded', 'failed', 'cancelled', 'expired']);
export const ACTIVE_STATUSES = Object.freeze(['claimed', 'running']);
export const ERROR_CLASSES = Object.freeze([
  'transient', 'deterministic', 'capacity', 'cancelled', 'policy', 'indeterminate',
]);
// Classes that may return to the queue while attempts remain.
export const RETRYABLE_ERROR_CLASSES = Object.freeze(['transient', 'capacity', 'indeterminate']);
export const REVIEW_DECISIONS = Object.freeze(['approved', 'rejected']);
export const ASSET_VERSION_STATUSES = Object.freeze(['draft', 'in_review', 'approved', 'rejected', 'archived']);
export const MIME_TYPES = Object.freeze([
  'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/wav', 'audio/mpeg', 'text/html',
]);
export const RENDER_METHODS = Object.freeze(['mock', 'upload', 'render', 'edit', 'composite']);

export function isCapability(value) { return CAPABILITIES.includes(value); }
export function isLane(value) { return LANES.includes(value); }
export function isTerminalStatus(value) { return TERMINAL_STATUSES.includes(value); }
export function isRetryableErrorClass(value) { return RETRYABLE_ERROR_CLASSES.includes(value); }
