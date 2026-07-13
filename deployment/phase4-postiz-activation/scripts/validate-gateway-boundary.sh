#!/bin/sh
set -eu

POOLER_HOST=aws-1-ap-south-1.pooler.supabase.com
GATEWAY_HOST=tanaghom-integration-gateway
NODE_IMAGE='node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd'
TOKEN_FILE="/run/tanaghom-gateway-token.$$"
trap 'rm -f "$TOKEN_FILE"' EXIT HUP INT TERM
umask 077
cat > "$TOKEN_FILE"
test "$(wc -c < "$TOKEN_FILE" | tr -d ' ')" -ge 32 || { echo "worker token is too short" >&2; exit 64; }

for container in smartlabs-n8n-n8n-1 smartlabs-n8n-n8n-worker-1; do
  docker run --rm -i --network "container:$container" \
    -v "$TOKEN_FILE:/run/secrets/worker-token:ro" \
    --entrypoint node "$NODE_IMAGE" - "$POOLER_HOST" "$GATEWAY_HOST" <<'JS'
const fs = require('node:fs');
const net = require('node:net');
const [pooler, gateway] = process.argv.slice(2);
const token = fs.readFileSync('/run/secrets/worker-token', 'utf8').trim();
const connect = (host, port) => new Promise((resolve) => {
  const socket = net.connect({host, port});
  let done = false;
  const finish = (connected, detail) => {
    if (done) return;
    done = true;
    socket.destroy();
    resolve({host, port, connected, detail});
  };
  socket.setTimeout(4000);
  socket.once('connect', () => finish(true, 'CONNECTED'));
  socket.once('timeout', () => finish(false, 'TIMEOUT'));
  socket.once('error', (error) => finish(false, error.code || 'ERROR'));
});
(async () => {
  for (const [host, port] of [[pooler, 5432], [gateway, 3000]]) {
    const result = await connect(host, port);
    console.log(`approved ${host}:${port} ${result.detail}`);
    if (!result.connected) process.exit(71);
  }
  const denied = await Promise.all([
    connect(gateway, 22), connect(gateway, 5678),
    connect('1.1.1.1', 443), connect('10.0.0.1', 5432),
    connect('38.247.187.232', 443), connect('38.247.187.232', 8026),
  ]);
  for (const result of denied) console.log(`denied ${result.host}:${result.port} ${result.detail}`);
  if (denied.some((result) => result.connected)) process.exit(72);
  const endpoint = `http://${gateway}:3000/api/internal/integrations/postiz/draft`;
  const unauthorized = await fetch(endpoint, {method: 'POST', body: '{}', headers: {'content-type': 'application/json'}});
  if (unauthorized.status !== 401) process.exit(73);
  const authorized = await fetch(endpoint, {method: 'POST', body: '{}', headers: {
    'content-type': 'application/json', authorization: `Bearer ${token}`,
  }});
  if (authorized.status !== 400) process.exit(74);
  console.log('PASS: network and gateway authentication boundary enforced.');
})().catch((error) => { console.error(error.message); process.exit(75); });
JS
done
