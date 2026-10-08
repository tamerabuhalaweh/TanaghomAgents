// Adapter registry. Business code resolves adapters by capability, never by
// provider import. P1a ships the mock adapter only; later phases register
// real adapters behind the same interface without touching domain logic.
const adapters = new Map();

function assertAdapterShape(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('adapter_must_be_object');
  if (typeof adapter.name !== 'string' || adapter.name.length === 0) throw new Error('adapter_name_required');
  if (!Array.isArray(adapter.capabilities) || adapter.capabilities.length === 0) throw new Error('adapter_capabilities_required');
  if (typeof adapter.execute !== 'function') throw new Error('adapter_execute_required');
}

export function registerAdapter(adapter) {
  assertAdapterShape(adapter);
  if (adapters.has(adapter.name)) throw new Error(`adapter_already_registered:${adapter.name}`);
  adapters.set(adapter.name, Object.freeze({ ...adapter, capabilities: Object.freeze([...adapter.capabilities]) }));
  return adapter.name;
}

export function getAdapter(name) {
  const adapter = adapters.get(name);
  if (!adapter) throw new Error(`unknown_adapter:${name}`);
  return adapter;
}

export function adaptersFor(capability) {
  return [...adapters.values()].filter((adapter) => adapter.capabilities.includes(capability));
}

export function clearAdapters() {
  adapters.clear();
}
