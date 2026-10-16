# syntax=docker/dockerfile:1
# SoK Game Calendar — web（網站＋API＋iCal＋內建排程）。16 §docker-compose。
# build context ＝ repo 根目錄（workspaces 的 packages/ 要進來）：
#   docker build -f apps/web/Dockerfile -t sok-web .
#
# 為什麼不用 output: "standalone"：
#   容器內要能跑 migration／seed（tsx＋drizzle-orm migrator＋src/ 的 `@/` 路徑），standalone 的 trace 不含這些；
#   為了省 image 大小而維護兩套 node_modules 不值得。這裡保留完整 workspace、`next start`，不改 next.config.ts。

ARG NODE_VERSION=22

# ── 1. 安裝相依（只有 package.json／lockfile 變動才重跑）────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

# ── 2. build ────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
# 這兩個在執行期才讀（env.ts 以參數物件取值），但頁面預渲染階段（canonical、sitemap 殼）可能用到，
# 所以 build 時帶同一個值，避免 image 內殘留 localhost 之類的預設。留白＝與不設相同。
ARG NEXT_PUBLIC_SITE_URL=
ARG MODULES=
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    MODULES=${MODULES} \
    NEXT_TELEMETRY_DISABLED=1
COPY apps/web apps/web
COPY packages packages
# build 不需要資料庫（register() 在 build 階段不執行；CI core-only job 同樣不連 DB）
RUN npm -w apps/web run build
# 只在執行用 image 裡用不到的大型 dev 套件（本機 PG、瀏覽器測試）
RUN rm -rf node_modules/@embedded-postgres node_modules/embedded-postgres \
           node_modules/playwright node_modules/playwright-core node_modules/@playwright node_modules/@axe-core \
 && rm -rf apps/web/.next/cache

# ── 3. 執行 ─────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app/apps/web
# 非 root（node 使用者 uid 1000）；.next/cache（ISR、next/image）需要可寫
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# 直接用 node 啟動（不經 npm／npx）才能正確收到 SIGTERM；compose 另設 init: true
CMD ["node", "/app/node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
# migration／seed（在容器內，工作目錄已是 apps/web）：
#   docker compose exec web npm run db:migrate
#   docker compose exec web npm run db:seed
