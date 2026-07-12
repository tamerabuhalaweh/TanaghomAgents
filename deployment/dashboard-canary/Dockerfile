FROM node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
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
COPY --chown=node:node deployment/dashboard-canary/entrypoint.sh /app/entrypoint.sh
RUN chmod 0555 /app/entrypoint.sh
USER node
ENTRYPOINT ["/app/entrypoint.sh"]
