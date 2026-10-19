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
ENV ANOMALY_DB_PATH=/data/the-anomaly.sqlite
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY package.json ./package.json
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "server/index.ts"]
