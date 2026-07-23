#!/bin/sh
set -eu

GATEWAY_HOST=tanaghom.38-247-187-232.sslip.io
PROXY_HOST=egress-proxy
NODE_IMAGE='node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd'
TOKEN_FILE="/run/tanaghom-provider-runtime-token.$$"
trap 'rm -f "$TOKEN_FILE"' EXIT HUP INT TERM
umask 077
cat > "$TOKEN_FILE"
test "$(wc -c < "$TOKEN_FILE" | tr -d ' ')" -ge 32 || {
  echo 'worker token is too short' >&2
  exit 64
}

! docker inspect tanaghom-dashboard-canary-dashboard-1 \
  --format '{{range $name,$value := .NetworkSettings.Networks}}{{$name}} {{end}}' |
  grep -E 'smartlabs-n8n|tanaghom-n8n' >/dev/null

for container in smartlabs-n8n-n8n-1 smartlabs-n8n-n8n-worker-1; do
  docker run --rm -i --network "container:$container" \
    -v "$TOKEN_FILE:/run/secrets/worker-token:ro" \
    --entrypoint node "$NODE_IMAGE" - "$PROXY_HOST" "$GATEWAY_HOST" <<'JS'
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
const [proxy, gateway] = process.argv.slice(2);
const token = fs.readFileSync('/run/secrets/worker-token', 'utf8').trim();
const socketConnect = (host, port) => new Promise((resolve) => {
  const socket = net.connect({ host, port });
  let done = false;
  const finish = (connected, detail) => {
    if (done) return;
    done = true;
    socket.destroy();
    resolve({ host, port, connected, detail });
  };
  socket.setTimeout(4000);
  socket.once('connect', () => finish(true, 'CONNECTED'));
  socket.once('timeout', () => finish(false, 'TIMEOUT'));
  socket.once('error', (error) => finish(false, error.code || 'ERROR'));
});
const tunnel = (host) => new Promise((resolve, reject) => {
  const request = http.request({ host: proxy, port: 3128, method: 'CONNECT', path: `${host}:443` });
  request.setTimeout(5000, () => request.destroy(new Error('proxy timeout')));
  request.once('connect', (response, socket) => resolve({ status: response.statusCode, socket }));
  request.once('response', (response) => resolve({ status: response.statusCode, socket: null }));
  request.once('error', reject);
  request.end();
});
const gatewayRequest = async (authorization) => {
  const connected = await tunnel(gateway);
  if (connected.status !== 200 || !connected.socket) return connected.status;
  return await new Promise((resolve, reject) => {
    const secure = tls.connect({ socket: connected.socket, servername: gateway, rejectUnauthorized: true });
    let response = '';
    secure.setTimeout(7000, () => secure.destroy(new Error('TLS timeout')));
    secure.once('secureConnect', () => {
      const auth = authorization ? `Authorization: Bearer ${authorization}\r\n` : '';
      secure.write(`POST /api/internal/integrations/postiz/draft HTTP/1.1\r\nHost: ${gateway}\r\nContent-Type: application/json\r\n${auth}Content-Length: 2\r\nConnection: close\r\n\r\n{}`);
    });
    secure.on('data', (chunk) => { response += chunk.toString('utf8'); });
    secure.once('end', () => resolve(Number(response.match(/^HTTP\/1\.1 (\d{3})/)?.[1] || 0)));
    secure.once('error', reject);
  });
};
(async () => {
  const allowed = await tunnel(gateway);
  console.log(`proxy approved ${gateway}:443 HTTP ${allowed.status}`);
  allowed.socket?.destroy();
  if (allowed.status !== 200) process.exit(71);
  const unapproved = await tunnel('example.com');
  console.log(`proxy denied example.com:443 HTTP ${unapproved.status}`);
  unapproved.socket?.destroy();
  if (unapproved.status === 200) process.exit(72);
  const direct = await Promise.all([
    socketConnect('38.247.187.232', 443),
    socketConnect('10.0.0.1', 5432),
    socketConnect('1.1.1.1', 443),
  ]);
  for (const result of direct) console.log(`direct denied ${result.host}:${result.port} ${result.detail}`);
  if (direct.some((result) => result.connected)) process.exit(73);
  const unauthorized = await gatewayRequest('');
  const authorized = await gatewayRequest(token);
  console.log(`gateway unauthorized HTTP ${unauthorized}`);
  console.log(`gateway authenticated-invalid HTTP ${authorized}`);
  if (unauthorized !== 401 || authorized !== 400) process.exit(74);
  console.log('PASS: exact Tanaghom proxy, TLS, authentication, and direct-egress boundaries are enforced.');
})().catch((error) => {
  console.error(error.message);
  process.exit(75);
});
JS
done
