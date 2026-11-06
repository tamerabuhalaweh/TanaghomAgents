import { readFileSync } from "node:fs";

const tokenFile = process.env.WORKSPACE_WORKER_TOKEN_FILE ?? "/run/secrets/workspace_worker_token";
const token = readFileSync(tokenFile, "utf8").trim();
if (!/^[a-f0-9]{64}$/.test(token)) {
  console.error("workspace_worker_token_invalid");
  process.exit(1);
}

const baseUrl = (process.env.DEMO_INTERNAL_BASE_URL ?? "http://dashboard:3000").replace(/\/$/, "");
const configuredPoll = Number(process.env.WORKSPACE_WORKER_POLL_MS ?? 5000);
const pollMs = Number.isInteger(configuredPoll) && configuredPoll >= 1000 && configuredPoll <= 60000 ? configuredPoll : 5000;
let stopping = false;
let wake = null;
let lastNotice = "";
let completed = 0;
const shutdown = new AbortController();

const notice = (message) => {
  if (message !== lastNotice) {
    console.log(message);
    lastNotice = message;
  }
};

async function tick() {
  const response = await fetch(`${baseUrl}/api/internal/agency-workspace`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: '{"action":"tick"}',
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(120000), shutdown.signal]),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    if (response.status === 503) notice("workspace_worker_waiting_for_activation");
    else console.error(`workspace_tick_failed status=${response.status}`);
    return;
  }
  const result = await response.json().catch(() => null);
  lastNotice = "";
  if (result?.claimed && result?.status) {
    completed += 1;
    console.log(`workspace_task_finished status=${result.status} total=${completed}`);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
}

function stop() {
  stopping = true;
  shutdown.abort();
  wake?.();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

for (;;) {
  if (stopping) break;
  try {
    await tick();
  } catch {
    if (!stopping) console.error("workspace_tick_transport_failed");
  }
  if (stopping) break;
  await wait(pollMs);
}
