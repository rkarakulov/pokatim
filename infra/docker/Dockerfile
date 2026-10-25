# syntax=docker/dockerfile:1.10
# Образы деплоя pokatim (docs/runbooks/deploy.md). Контекст — корень репозитория, цели:
#   api   — NestJS HTTP (dist/main.js), worker (dist/worker.js) и миграции MongoDB (dist/db/migrate.js) — один образ;
#   web   — SSR-сервер приложения (apps/app/server, expo-server) со сборкой `build:web`;
#   admin — статика панели «Протокол» под путём /admin/ (nginx без root).
# Сборка (linux/amd64; токен GitHub Packages — build secret, в слои не попадает):
#   docker build --platform linux/amd64 -f infra/docker/Dockerfile --target api \
#     --secret id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN -t ghcr.io/rkarakulov/pokatim-api:<тег> .
#   web дополнительно: --build-arg EXPO_PUBLIC_API_URL=https://<домен> (публичный адрес, вшивается в бандл).

ARG NODE_IMAGE=node:24.22-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

# ---------- установка зависимостей монорепо (общая для всех целей) ----------
FROM ${NODE_IMAGE} AS deps
ENV CI=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    EXPO_NO_TELEMETRY=1 \
    npm_config_update_notifier=false
RUN npm install --global --no-audit --no-fund pnpm@11.18.0
WORKDIR /repo
# только манифесты: слой установки пересобирается лишь при смене зависимостей.
# Новый workspace-пакет — добавить его package.json сюда (иначе frozen-lockfile упадёт).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/install-git-hooks.mjs scripts/
COPY apps/api/package.json apps/api/
COPY apps/app/package.json apps/app/
COPY apps/admin/package.json apps/admin/
COPY packages/contracts/package.json packages/contracts/
COPY packages/api-client/package.json packages/api-client/
COPY packages/tracks/package.json packages/tracks/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/i18n/package.json packages/i18n/
# @rkarakulov/* — GitHub Packages: токен только из secret на время этого RUN; ~/.npmrc содержит ссылку на
# переменную (как локально, docs/runbooks/local-dev.md), не значение, и удаляется в том же слое
RUN --mount=type=secret,id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN \
    test -n "$NODE_AUTH_TOKEN" || { echo 'нет build secret NODE_AUTH_TOKEN' >&2; exit 1; }; \
    printf '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n' > /root/.npmrc \
    && pnpm install --frozen-lockfile \
    && rm -f /root/.npmrc \
    && rm -rf /root/.local/share/pnpm/store /root/.cache
COPY . .

# ---------- api: сборка и минимальный node_modules ----------
FROM deps AS build-api
RUN pnpm turbo run build --filter=@pokatim/api \
    && node infra/docker/runtime-deps.mjs /repo /out ./apps/api \
    && mkdir -p /out/apps/api \
    && cp -r apps/api/dist apps/api/package.json /out/apps/api/

FROM ${NODE_IMAGE} AS api
LABEL org.opencontainers.image.source="https://github.com/rkarakulov/pokatim" \
      org.opencontainers.image.description="pokatim API, worker и миграции" \
      by.pokatim.project="pokatim"
ENV NODE_ENV=production
COPY --from=build-api /out /app
WORKDIR /app/apps/api
USER node
EXPOSE 3000
# worker: node dist/worker.js; миграции: node dist/db/migrate.js (MONGO_URL)
CMD ["node", "dist/main.js"]

# ---------- web: build:web (SSR + PWA) и сервер ----------
FROM deps AS build-web
# публичный адрес API (тот же origin, что сайт): клиентский бандл получает его при сборке
ARG EXPO_PUBLIC_API_URL
RUN test -n "$EXPO_PUBLIC_API_URL" || { echo 'нужен --build-arg EXPO_PUBLIC_API_URL' >&2; exit 1; }; \
    EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" pnpm --filter @pokatim/app build:web \
    && node infra/docker/runtime-deps.mjs /repo /out express expo-server \
    && mkdir -p /out/apps/app/server \
    && cp -r apps/app/dist /out/apps/app/ \
    && cp apps/app/server/main.ts apps/app/server/web-server.ts apps/app/server/package.json /out/apps/app/server/

FROM ${NODE_IMAGE} AS web
LABEL org.opencontainers.image.source="https://github.com/rkarakulov/pokatim" \
      org.opencontainers.image.description="pokatim web/PWA (SSR)" \
      by.pokatim.project="pokatim"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
COPY --from=build-web /out /app
WORKDIR /app/apps/app
USER node
EXPOSE 8080
CMD ["node", "server/main.ts"]

# ---------- admin: статика под /admin/ ----------
FROM deps AS build-admin
ARG ADMIN_BASE=/admin/
RUN ADMIN_BASE="$ADMIN_BASE" pnpm --filter @pokatim/admin build

FROM ${NGINX_IMAGE} AS admin
LABEL org.opencontainers.image.source="https://github.com/rkarakulov/pokatim" \
      org.opencontainers.image.description="pokatim admin (статика)" \
      by.pokatim.project="pokatim"
COPY infra/docker/admin-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-admin /repo/apps/admin/dist /usr/share/nginx/html/admin
EXPOSE 8080
