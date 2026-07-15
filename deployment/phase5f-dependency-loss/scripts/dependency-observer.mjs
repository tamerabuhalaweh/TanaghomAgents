import { appendFile, readFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { connect } from "node:net";

const port = Number(process.env.TANAGHOM_DEPENDENCY_OBSERVER_PORT || 14334);
const alertFile = process.env.TANAGHOM_DEPENDENCY_ALERT_FILE || "/tmp/tanaghom-dependency-alerts.ndjson";
const mainUrl = process.env.TANAGHOM_N8N_MAIN_URL || "http://n8n:5678";
const postgresHost = process.env.TANAGHOM_POSTGRES_HOST || "postgres";
const postgresPort = Number(process.env.TANAGHOM_POSTGRES_PORT || 5432);
const redisHost = process.env.TANAGHOM_REDIS_HOST || "redis";
const redisPort = Number(process.env.TANAGHOM_REDIS_PORT || 6379);
const redisPasswordFile = process.env.TANAGHOM_REDIS_PASSWORD_FILE || "/run/secrets/redis_password";
const deliveredDependencyAlerts = new Set();

function tcpProbe(host, targetPort, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = connect({ host, port: targetPort });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function redisPing(timeoutMs = 2000) {
  const password = (await readFile(redisPasswordFile, "utf8")).trim();
  return new Promise((resolve) => {
    const socket = connect({ host: redisHost, port: redisPort });
    let output = "";
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => {
      const auth = `*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n`;
      socket.write(`${auth}*1\r\n$4\r\nPING\r\n`);
    });
    socket.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (output.includes("+PONG\r\n")) finish(true);
      else if (output.includes("-ERR")) finish(false);
    });
    socket.once("error", () => finish(false));
  });
}

async function mainReady() {
  try {
    const response = await fetch(`${mainUrl}/healthz/readiness`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function observe() {
  const [postgres_reachable, redis_ping, n8n_main_readiness] = await Promise.all([
    tcpProbe(postgresHost, postgresPort),
    redisPing(),
    mainReady(),
  ]);
  let code = "healthy";
  if (!redis_ping) code = "redis_unavailable";
  else if (!postgres_reachable) code = "postgres_unavailable";
  else if (!n8n_main_readiness) code = "n8n_main_unready";
  const observation = {
    contract_version: "phase5.dependency-observation.v1",
    observed_at: new Date().toISOString(),
    state: code === "healthy" ? "healthy" : "degraded",
    code,
    postgres_reachable,
    redis_ping,
    n8n_main_readiness,
  };
  if (
    ["redis_unavailable", "postgres_unavailable"].includes(observation.code)
    && !deliveredDependencyAlerts.has(observation.code)
  ) {
    await appendFile(alertFile, `${JSON.stringify({
      ...observation,
      contract_version: "phase5.dependency-alert.v1",
    })}\n`, "utf8");
    deliveredDependencyAlerts.add(observation.code);
  }
  return observation;
}

const server = createHttpServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    if (request.method === "POST" && request.url === "/observe") {
      const result = await observe();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
      return;
    }
    if (request.method === "GET" && request.url === "/alerts") {
      const body = await readFile(alertFile, "utf8").catch(() => "");
      response.writeHead(200, { "content-type": "application/x-ndjson" });
      response.end(body);
      return;
    }
    response.writeHead(404).end();
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, "0.0.0.0");
