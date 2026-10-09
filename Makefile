SHELL := /bin/bash
PYTHON ?= python3

.PHONY: all help format-check lint typecheck test scan handoff-check ci

all: ci

help:
	@echo "Available targets:"
	@echo "  make ci             - Run complete local CI gate (format, lint, types, tests, scan, handoff)"
	@echo "  make format-check   - Check line endings, whitespace, and formatting standards"
	@echo "  make lint           - Run syntax and code quality checks"
	@echo "  make typecheck      - Run type checking validation"
	@echo "  make test           - Run automated test suite"
	@echo "  make scan           - Run Gitleaks secret and PII pattern scanning"
	@echo "  make handoff-check  - Validate milestone handoff protocol integrity"

format-check:
	@echo "==> Running format check..."
	@$(PYTHON) scripts/format_check.py

lint:
	@echo "==> Running lint check..."
	@$(PYTHON) scripts/lint.py

typecheck:
	@echo "==> Running type check..."
	@$(PYTHON) scripts/typecheck.py

test:
	@echo "==> Running tests..."
	@$(PYTHON) -m unittest discover -s tests

scan:
	@echo "==> Running secret & PII scan..."
	@$(PYTHON) scripts/check_secrets_pii.py

handoff-check:
	@echo "==> Running milestone handoff check..."
	@$(PYTHON) scripts/check_milestone_handoff.py

ci: format-check lint typecheck test scan handoff-check
	@echo ""
	@echo "=========================================="
	@echo "  Local CI validation gate PASSED (All OK)"
	@echo "=========================================="

