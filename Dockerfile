# 以虎 One 按 yh-app.json 构建这个镜像：一个容器，后端顺带托管前端构建产物。
# 慢网络：docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#   --build-arg PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma .
ARG NODE_IMAGE=node:20-alpine

# ---- 前端 ----
FROM ${NODE_IMAGE} AS web
ARG NPM_REGISTRY=
WORKDIR /src
COPY frontend/package*.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi && npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 后端 + 前端构建产物 ----
FROM ${NODE_IMAGE}
ARG NPM_REGISTRY=
ARG PRISMA_ENGINES_MIRROR=
WORKDIR /app
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi \
 && if [ -z "$PRISMA_ENGINES_MIRROR" ]; then unset PRISMA_ENGINES_MIRROR; fi \
 && npm ci --omit=dev --no-audit --no-fund \
 && npx prisma generate
COPY backend/src ./src/
COPY --from=web /src/dist ./public
ENV NODE_ENV=production PORT=3000 STATIC_DIR=/app/public
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
