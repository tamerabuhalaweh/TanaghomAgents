// @tanaghom/creative-runtime — bounded Creative Runtime foundation (P1a).
// Capability contracts first; the mock adapter is the only implementation.
// Real providers arrive as adapters in later phases without touching callers.
export * as capabilities from './capabilities.mjs';
export * as registry from './registry.mjs';
export * as repository from './repository.mjs';
export * as queue from './queue.mjs';
export * as storageKeys from './storage/keys.mjs';
export { mockAdapter, mockExecute, MOCK_ADAPTER_NAME } from './adapters/mock.mjs';
export { createTestStorage } from './storage/test-adapter.mjs';
