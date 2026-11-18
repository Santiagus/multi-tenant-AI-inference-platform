# Local Compose control plane + Python/PyTorch worker bridge.
# Cloud deploys do NOT use this image (ECS Fargate API + EKS/cloud workers).
FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.10.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/

RUN pnpm install

COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src

WORKDIR /app/apps/api
RUN pnpm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

# 1 = CUDA wheels (also run on CPU). 0 = CPU-only wheels (smaller/faster).
ARG INSTALL_CUDA_TORCH=1
# 1 = install transformers/diffusers stack for pretrained checkpoints (slow first build).
# 0 = skip HF stack (mock/synthetic + text stub only; much faster image builds).
ARG INSTALL_HF_STACK=1

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PYTHON_BIN=python3

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      ca-certificates \
      wget && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && corepack prepare pnpm@12.10.1 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
RUN pnpm install --prod

COPY --from=builder /app/apps/api/dist ./apps/api/dist

# --- Python deps (split + BuildKit pip cache) ---
# Torch and HF are separate layers so a requirements-runtime.txt change does not
# re-download CUDA torch. Pip cache mounts keep wheels across rebuilds even when
# a layer is invalidated (DOCKER_BUILDKIT=1 / Compose BuildKit default).
COPY apps/worker/pyproject.toml ./apps/worker/pyproject.toml

RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install --break-system-packages --upgrade pip && \
    pip3 install --break-system-packages \
      "numpy>=1.24.0" "psutil>=5.9.0" "pyyaml>=6.0.0" && \
    if [ "${INSTALL_CUDA_TORCH}" = "1" ]; then \
      pip3 install --break-system-packages \
        torch \
        --index-url https://download.pytorch.org/whl/cu124 \
        --extra-index-url https://pypi.org/simple; \
    else \
      pip3 install --break-system-packages \
        torch \
        --index-url https://download.pytorch.org/whl/cpu \
        --extra-index-url https://pypi.org/simple; \
    fi

COPY apps/worker/requirements-runtime.txt ./apps/worker/requirements-runtime.txt

RUN --mount=type=cache,target=/root/.cache/pip \
    if [ "${INSTALL_HF_STACK}" = "1" ]; then \
      pip3 install --break-system-packages \
        -r ./apps/worker/requirements-runtime.txt; \
      if [ "${INSTALL_CUDA_TORCH}" = "1" ]; then \
        pip3 install --break-system-packages bitsandbytes || true; \
      fi; \
    else \
      echo "INSTALL_HF_STACK=0 — skipping transformers/diffusers install"; \
    fi

# Worker sources last — code edits must not invalidate torch/HF wheel layers.
COPY apps/__init__.py ./apps/__init__.py
COPY apps/worker ./apps/worker
RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install --break-system-packages --no-deps ./apps/worker

ENV INSTALL_CUDA_TORCH=${INSTALL_CUDA_TORCH} \
    INSTALL_HF_STACK=${INSTALL_HF_STACK}

WORKDIR /app/apps/api

EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
  CMD wget -q -O - http://localhost:3000/healthz || exit 1

CMD ["node", "dist/server.js"]
