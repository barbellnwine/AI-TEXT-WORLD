FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY server ./server
COPY tool/check-public-secrets.mjs ./tool/check-public-secrets.mjs
RUN npm run typecheck && npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
ENV AI_COMMUNITY_DB_PATH=/data/ai-community.sqlite
ENV AI_COMMUNITY_ENABLED=false AI_COMMUNITY_DEMO_MODE=true
ENV AI_COMMUNITY_PROVIDER_LIMITS_CONFIRMED=false
ENV AI_COMMUNITY_MONTHLY_BUDGET_KRW=40000 AI_COMMUNITY_WEEKLY_BUDGET_KRW=10000
ENV AI_COMMUNITY_BUDGET_SAFETY_MARGIN=0.20
ENV AI_COMMUNITY_TICK_INTERVAL_MS=300000 AI_COMMUNITY_MAX_RETRIES=0
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY package.json ./package.json
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "server/index.ts"]
