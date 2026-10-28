# syntax=docker/dockerfile:1.7
# Targets:
#   dev     — workspace with all dependencies; source is bind-mounted (compose.dev.yaml)
#   runtime — production image: built server + Mini App + prod dependencies (compose.yaml)

ARG NODE_VERSION=22.23.1

FROM node:${NODE_VERSION}-bookworm-slim AS os
# Prisma's query engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM os AS base
ENV PNPM_STORE_DIR=/pnpm/store \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
WORKDIR /app
# pnpm version comes from "packageManager" in package.json.
COPY package.json ./
RUN corepack enable && corepack install

# Manifests only, so dependency layers are rebuilt only when they change.
# The Prisma schema is needed by the server's postinstall (prisma generate).
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/server/prisma apps/server/prisma
COPY apps/miniapp/package.json apps/miniapp/
COPY packages/shared/package.json packages/shared/

FROM manifests AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir "$PNPM_STORE_DIR"

FROM deps AS dev
CMD ["pnpm", "dev"]

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/miniapp apps/miniapp
RUN pnpm build

# Production dependencies of the server only (keeps the workspace layout: the server
# serves the Mini App from ../../miniapp/dist relative to its dist/main.js).
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --prod --frozen-lockfile --store-dir "$PNPM_STORE_DIR" --filter "@istock/server..."

FROM os AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Files stay owned by root: the app only reads them.
COPY --from=prod-deps /app ./
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/miniapp/dist apps/miniapp/dist
WORKDIR /app/apps/server
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# node is PID 1 without a shell, so SIGTERM reaches the graceful shutdown in main.ts.
CMD ["node", "dist/main.js"]
