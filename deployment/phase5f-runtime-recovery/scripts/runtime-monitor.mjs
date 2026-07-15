const mainUrl = process.env.TANAGHOM_N8N_MAIN_URL;
const workerUrl = process.env.TANAGHOM_N8N_WORKER_URL;
const alertUrl = process.env.TANAGHOM_RUNTIME_ALERT_URL;
const timeoutMs = Number(process.env.TANAGHOM_RUNTIME_MONITOR_TIMEOUT_MS || "3000");
if (!mainUrl || !workerUrl || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
  throw new Error("valid TANAGHOM_N8N_MAIN_URL, TANAGHOM_N8N_WORKER_URL, and monitor timeout are required");
}

async function probe(name, baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/healthz/readiness`, { signal: AbortSignal.timeout(timeoutMs) });
    return { name, ready: response.ok, http_status: response.status };
  } catch (error) {
    return { name, ready: false, http_status: 0, error_code: error.cause?.code || error.code || error.name };
  }
}

const probes = await Promise.all([probe("n8n_main", mainUrl), probe("n8n_worker", workerUrl)]);
const failures = probes.filter((entry) => !entry.ready);
const observation = {
  contract_version: "phase5.n8n-runtime-observation.v1",
  observed_at: new Date().toISOString(),
  state: failures.length ? "degraded" : "healthy",
  probes,
};

if (failures.length && alertUrl) {
  const alert = {
    contract_version: "phase5.runtime-alert.v1",
    emitted_at: new Date().toISOString(),
    severity: "critical",
    code: failures.some((entry) => entry.name === "n8n_worker") ? "n8n_worker_unready" : "n8n_main_unready",
    summary: "The disposable Tanaghom n8n runtime readiness boundary is degraded.",
    failed_components: failures.map((entry) => entry.name),
  };
  const response = await fetch(alertUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(alert),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`runtime alert delivery failed with HTTP ${response.status}`);
  observation.alert_delivery = { attempted: true, delivered: true, http_status: response.status, code: alert.code };
} else {
  observation.alert_delivery = { attempted: false, delivered: false };
}

console.log(JSON.stringify(observation));
process.exitCode = failures.length ? 2 : 0;
