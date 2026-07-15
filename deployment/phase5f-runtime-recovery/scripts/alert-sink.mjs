import { appendFile } from "node:fs/promises";
import { createServer } from "node:http";

const port = Number(process.env.TANAGHOM_ALERT_SINK_PORT || "14333");
const output = process.env.TANAGHOM_ALERT_SINK_FILE || "/tmp/tanaghom-runtime-alerts.ndjson";
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("valid alert sink port required");

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== "POST" || request.url !== "/alerts") {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const alert = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  await appendFile(output, `${JSON.stringify(alert)}\n`, "utf8");
  response.writeHead(204).end();
}).listen(port, "127.0.0.1", () => {
  console.log(`disposable alert sink ready on ${port}`);
});
