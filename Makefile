SHELL := /bin/bash
PYTHON ?= $(shell if [ -x .venv/bin/python ]; then echo .venv/bin/python; else echo python3; fi)
export PATH := $(CURDIR)/.venv/bin:$(PATH)
export COREPACK_ENABLE_DOWNLOAD_PROMPT := 0
export COREPACK_HOME := $(CURDIR)/.cache/corepack

.PHONY: all help init format format-check lint validate-mermaid typecheck test scan handoff-check ci install-hooks simulate-observability validate-k8s validate-terraform sync-models benchmark-engines benchmark-inference benchmark-production-reality check-providers

all: ci

help:
	@echo "Available targets:"
	@echo "  make init                   - Initialize local .venv, pnpm, and workspace dependencies"
	@echo "  make sync-models            - Materialize all 12 domain-organized models in models/ and update manifest.json"
	@echo "  make ci                     - Run complete local CI gate (format, lint, types, tests, scan, handoff)"
	@echo "  make format                 - Automatically format Python code and organize imports (Ruff)"
	@echo "  make format-check           - Check line endings, whitespace, and formatting standards"
	@echo "  make lint                   - Run syntax and code quality checks (Python, JSON, Mermaid)"
	@echo "  make validate-mermaid       - Validate Mermaid diagram syntax in Markdown documentation"
	@echo "  make typecheck              - Run type checking validation"
	@echo "  make test                   - Run automated test suite"
	@echo "  make scan                   - Run Gitleaks secret and PII pattern scanning"
	@echo "  make handoff-check          - Validate milestone handoff protocol integrity"
	@echo "  make validate-k8s           - Render Helm charts and validate KEDA, Kueue, and Kyverno policies"
	@echo "  make validate-terraform     - Validate AWS Terraform modules, IAM policies, and cost guardrails"
	@echo "  make simulate-observability - Run live workload simulator to populate Grafana & Prometheus"
	@echo "  make benchmark-engines      - Run multi-engine category benchmark sweep (NumPy, PyTorch, Compile)"
	@echo "  make benchmark-inference    - Run concurrency and prompt-tier inference benchmark"
	@echo "  make benchmark-production-reality - Run dynamic shape churn and cold scaling production test"
	@echo "  make check-providers        - Run provider and hardware acceleration diagnostics"
	@echo "  make install-hooks          - Configure local Git repository to run pre-commit hook"

init:
	@bash scripts/init_env.sh

format:
	@echo "==> Formatting code and organizing imports (Ruff)..."
	@$(PYTHON) -m ruff format .
	@$(PYTHON) -m ruff check --fix .

sync-models:
	@echo "==> Synchronizing domain-organized local AI model store (models/)..."
	@$(PYTHON) scripts/sync_models.py --fetch-hf

format-check:
	@echo "==> Running format check..."
	@$(PYTHON) scripts/format_check.py

lint:
	@echo "==> Running lint check..."
	@$(PYTHON) scripts/lint.py

validate-mermaid:
	@echo "==> Running Mermaid syntax validation..."
	@$(PYTHON) scripts/validate_mermaid.py

typecheck:
	@echo "==> Running type check..."
	@$(PYTHON) scripts/typecheck.py

test:
	@echo "==> Running tests..."
	@$(PYTHON) -m unittest discover -s tests
	@if [ -f package.json ]; then pnpm test; fi

scan:
	@echo "==> Running secret & PII scan..."
	@$(PYTHON) scripts/check_secrets_pii.py

handoff-check:
	@echo "==> Running milestone handoff check..."
	@$(PYTHON) scripts/check_milestone_handoff.py

validate-k8s:
	@echo "==> Validating Kubernetes Helm charts, KEDA, Kueue, and Kyverno policies..."
	@$(PYTHON) scripts/validate_kubernetes.py

validate-terraform:
	@echo "==> Validating AWS Terraform modules, IAM policies, cost guardrails, and ephemeral lifecycle..."
	@$(PYTHON) scripts/validate_terraform.py

simulate-observability:
	@echo "==> Running observability workload simulator..."
	@$(PYTHON) scripts/simulate_observability_workload.py

benchmark-engines:
	@echo "==> Running multi-engine category benchmark sweep..."
	@$(PYTHON) benchmarks/run_engine_comparison.py

benchmark-inference:
	@echo "==> Running concurrency and prompt-tier inference benchmark..."
	@$(PYTHON) benchmarks/run_inference_benchmark.py

benchmark-production-reality:
	@echo "==> Running production reality dynamic shape churn and cold scaling test..."
	@$(PYTHON) benchmarks/run_production_reality_test.py

check-providers:
	@echo "==> Checking provider and hardware diagnostics..."
	@$(PYTHON) scripts/setup_providers.py --check

ci: format-check lint typecheck test scan handoff-check
	@echo ""
	@echo "=========================================="
	@echo "  Local CI validation gate PASSED (All OK)"
	@echo "=========================================="

install-hooks:
	@echo "==> Configuring Git core.hooksPath to .githooks..."
	@git config core.hooksPath .githooks
	@chmod +x .githooks/pre-commit
	@echo "Git pre-commit hook installed successfully."


