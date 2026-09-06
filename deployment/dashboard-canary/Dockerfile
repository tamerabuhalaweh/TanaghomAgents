FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/agent-runtime/package.json packages/agent-runtime/package.json
RUN npm ci

FROM dependencies AS builder
COPY . .
RUN npm run build:dashboard

FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /workspace/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=node:node /workspace/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=node:node /workspace/packages/agent-runtime ./packages/agent-runtime
COPY --from=builder --chown=node:node /workspace/packages/contracts ./packages/contracts
COPY --from=builder --chown=node:node /workspace/config ./config
COPY --from=builder --chown=node:node /workspace/skills ./skills
COPY --from=builder --chown=node:node /workspace/prompts ./prompts
COPY --from=builder --chown=node:node /workspace/n8n/workflows/phase7d ./n8n/workflows/phase7d
COPY --from=dependencies --chown=node:node /workspace/node_modules/ajv ./node_modules/ajv
COPY --from=dependencies --chown=node:node /workspace/node_modules/ajv-formats ./node_modules/ajv-formats
COPY --from=dependencies --chown=node:node /workspace/node_modules/fast-deep-equal ./node_modules/fast-deep-equal
COPY --from=dependencies --chown=node:node /workspace/node_modules/fast-uri ./node_modules/fast-uri
COPY --from=dependencies --chown=node:node /workspace/node_modules/json-schema-traverse ./node_modules/json-schema-traverse
COPY --from=dependencies --chown=node:node /workspace/node_modules/require-from-string ./node_modules/require-from-string
COPY --chown=node:node deployment/dashboard-canary/entrypoint.sh /app/entrypoint.sh
RUN chmod 0555 /app/entrypoint.sh
RUN mkdir -p /app/node_modules/@tanaghom && ln -s ../../packages/agent-runtime /app/node_modules/@tanaghom/agent-runtime
USER node
ENTRYPOINT ["/app/entrypoint.sh"]
