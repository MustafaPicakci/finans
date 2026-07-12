FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/engine/package.json packages/engine/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build
# Veri artık PostgreSQL'de (DATABASE_URL ile dışarıdan verilir — bkz. docker-compose.yml).
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["pnpm", "--filter", "@finans/server", "start"]
