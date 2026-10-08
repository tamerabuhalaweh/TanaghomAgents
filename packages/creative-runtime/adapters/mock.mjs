// Deterministic mock adapter. Proves the full queue -> worker -> artifact
// metadata -> completion lifecycle without any model, GPU, or network call.
// Scripted outcomes via params.mock.outcome: 'succeeded' (default),
// 'transient', 'deterministic', 'capacity', 'policy'. Anything else throws
// a deterministic validation error (never retried as transient).
import { createHash } from 'node:crypto';

export const MOCK_ADAPTER_NAME = 'mock';
const MAX_MOCK_BYTES = 1024 * 1024;

export class MockAdapterError extends Error {
  constructor(errorClass, message) {
    super(message);
    this.name = 'MockAdapterError';
    this.errorClass = errorClass;
  }
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

export function mockArtifactBytes({ capability, jobId, params }) {
  const digest = createHash('sha256').update(canonicalJson({ capability, jobId, params })).digest();
  const size = Math.min(
    MAX_MOCK_BYTES,
    Math.max(16, Number.isInteger(params?.mock?.bytes) ? params.mock.bytes : 64),
  );
  const out = Buffer.alloc(size);
  for (let offset = 0; offset < size; offset += digest.length) {
    digest.copy(out, offset, 0, Math.min(digest.length, size - offset));
  }
  return out;
}

export async function mockExecute({ capability, jobId, params = {}, organizationId }) {
  if (!capability || !jobId || !organizationId) {
    throw new MockAdapterError('deterministic', 'mock adapter requires capability, jobId, and organizationId');
  }
  const outcome = params?.mock?.outcome ?? 'succeeded';
  if (outcome !== 'succeeded') {
    if (!['transient', 'deterministic', 'capacity', 'policy'].includes(outcome)) {
      throw new MockAdapterError('deterministic', `unknown mock outcome: ${outcome}`);
    }
    throw new MockAdapterError(outcome, `scripted mock ${outcome} for ${capability}`);
  }
  const bytes = mockArtifactBytes({ capability, jobId, params });
  return {
    adapter: MOCK_ADAPTER_NAME,
    mime: 'image/png',
    width: 1024,
    height: 1024,
    durationMs: null,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    provenance: { adapter: MOCK_ADAPTER_NAME, capability, deterministic: true },
    method: 'mock',
  };
}

export const mockAdapter = Object.freeze({
  name: MOCK_ADAPTER_NAME,
  capabilities: Object.freeze(['image', 'edit', 'product_shoot', 'design', 'carousel', 'motion', 'video', 'talking_head', 'voice', 'music', 'landing_page']),
  execute: mockExecute,
});
