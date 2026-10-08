// Retry, backoff, and cancellation policy helpers. Pure functions so the
// worker loop, n8n lane, and tests share one decision table.
import { RETRYABLE_ERROR_CLASSES, TERMINAL_STATUSES } from './capabilities.mjs';

export const DEFAULT_BASE_BACKOFF_MS = 1000;
export const DEFAULT_MAX_BACKOFF_MS = 60000;

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

export function isRetryableFailure(errorClass, attempt, maxAttempts) {
  if (!RETRYABLE_ERROR_CLASSES.includes(errorClass)) return false;
  if (!Number.isInteger(attempt) || !Number.isInteger(maxAttempts)) return false;
  return attempt < maxAttempts;
}

// Deterministic exponential backoff with a hard cap. Jitter is a worker-loop
// concern and intentionally excluded so schedules stay reproducible in tests.
export function backoffMs(attempt, baseMs = DEFAULT_BASE_BACKOFF_MS, capMs = DEFAULT_MAX_BACKOFF_MS) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt_must_be_positive_integer');
  if (!(baseMs > 0) || !(capMs > 0)) throw new Error('backoff_bounds_must_be_positive');
  return Math.min(capMs, baseMs * 2 ** (attempt - 1));
}

export function nextStatusAfterFailure(errorClass, attempt, maxAttempts) {
  if (errorClass === 'cancelled') return 'cancelled';
  if (errorClass === 'deterministic' || errorClass === 'policy') return 'failed';
  return isRetryableFailure(errorClass, attempt, maxAttempts) ? 'queued' : 'failed';
}

export function shouldHonorCancel(status, cancelRequested) {
  if (!cancelRequested) return false;
  return status === 'queued' || status === 'claimed' || status === 'running';
}
