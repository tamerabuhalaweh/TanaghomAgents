#!/bin/sh
set -eu

N8N_CONTAINER=${N8N_CONTAINER:-smartlabs-n8n-n8n-1}
POOLER_HOST=${POOLER_HOST:-aws-1-ap-south-1.pooler.supabase.com}
POOLER_PORT=5432
PROTECTED_HOST=38.247.187.232
NODE_IMAGE='node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd'

docker inspect "$N8N_CONTAINER" >/dev/null
docker run --rm -i --network "container:$N8N_CONTAINER" --entrypoint node "$NODE_IMAGE" - "$POOLER_HOST" "$POOLER_PORT" "$PROTECTED_HOST" <<'JS'
const net = require('node:net');
const [host, portText, protectedHost] = process.argv.slice(2);
const port = Number(portText);
const connect = (target, targetPort) => new Promise((resolve) => {
  const socket = net.connect({host: target, port: targetPort});
  let done = false;
  const finish = (connected, detail) => {
    if (done) return;
    done = true;
    socket.destroy();
    resolve({target, targetPort, connected, detail});
  };
  socket.setTimeout(5000);
  socket.once('connect', () => finish(true, 'CONNECTED'));
  socket.once('timeout', () => finish(false, 'TIMEOUT'));
  socket.once('error', (error) => finish(false, error.code || 'ERROR'));
});
(async () => {
  const approved = await connect(host, port);
  console.log(`approved pooler ${approved.detail}`);
  if (!approved.connected) process.exit(71);
  const denied = await Promise.all([
    connect(host, 443),
    connect('1.1.1.1', 443),
    connect('10.0.0.1', 5432),
    connect(protectedHost, 443),
    connect(protectedHost, 8026),
  ]);
  for (const result of denied) console.log(`denied ${result.target}:${result.targetPort} ${result.detail}`);
  if (denied.some((result) => result.connected)) process.exit(72);
  console.log('PASS: only approved Supabase TCP/5432 egress succeeded.');
})().catch((error) => { console.error(error.message); process.exit(73); });
JS
