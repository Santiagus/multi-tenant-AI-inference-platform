# Multi-stage build for Fastify Control Plane API
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.10.1 --activate

# Copy dependency manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/

# Install build dependencies
RUN pnpm install

# Copy source files
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src

# Compile TypeScript and copy assets
WORKDIR /app/apps/api
RUN pnpm run build

# Runtime Stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

RUN corepack enable && corepack prepare pnpm@12.10.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/

RUN pnpm install --prod

COPY --from=builder /app/apps/api/dist ./apps/api/dist

WORKDIR /app/apps/api

USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]

