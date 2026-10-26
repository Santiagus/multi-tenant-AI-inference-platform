# Multi-stage build for React Dashboard
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.10.1 --activate

# Copy dependency manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/dashboard/package.json ./apps/dashboard/

# Install build dependencies
RUN pnpm install

# Copy source files
COPY apps/dashboard/tsconfig.json apps/dashboard/vite.config.ts apps/dashboard/index.html ./apps/dashboard/
COPY apps/dashboard/src ./apps/dashboard/src

# Build dashboard distribution
WORKDIR /app/apps/dashboard
RUN pnpm run build

# Runtime Stage
FROM nginx:alpine

COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
