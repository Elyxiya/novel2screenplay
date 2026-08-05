# Docker 配置 (P1 预留，monorepo 版，npm workspaces)
# 注：应用未启用 standalone 输出（见 apps/screenplay/next.config.ts 注释），运行阶段直接 next start
FROM node:20-alpine AS base

# 依赖安装
FROM base AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/screenplay/package.json ./apps/screenplay/
RUN npm ci

# 构建
FROM deps AS builder
WORKDIR /workspace
COPY . .
RUN npm run build

# 运行
FROM base AS runner
WORKDIR /workspace/apps/screenplay

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /workspace /workspace

USER nextjs

EXPOSE 3000
CMD ["node", "node_modules/.bin/next", "start", "-p", "3000"]
