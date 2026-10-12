# Multi-stage build for Python PyTorch / CPU-Fallback Inference Worker
FROM python:3.11-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY apps/worker/pyproject.toml ./apps/worker/pyproject.toml
COPY apps/__init__.py ./apps/__init__.py
COPY apps/worker ./apps/worker

RUN pip install --upgrade pip && \
    pip install --prefix=/install ./apps/worker

# Runtime Stage
FROM python:3.11-slim AS runner

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    WORKER_MODE=kubernetes

RUN groupadd -g 10001 worker && \
    useradd -u 10001 -g worker -m -s /usr/sbin/nologin worker && \
    mkdir -p /app/artifacts && \
    chown -R 10001:10001 /app

COPY --from=builder /install /usr/local
COPY --chown=10001:10001 apps/__init__.py ./apps/__init__.py
COPY --chown=10001:10001 apps/worker ./apps/worker

USER 10001:10001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD ["python3", "-m", "apps.worker.consumer", "--healthcheck"]

CMD ["python3", "-m", "apps.worker.consumer", "--healthcheck"]

