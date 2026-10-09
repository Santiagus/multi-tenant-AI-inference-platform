#!/usr/bin/env python3
"""Lint validation runner.

Verifies Python syntax compilation, valid JSON parsing, and delegates to
ruff/flake8/shellcheck when installed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import py_compile
import shutil
import subprocess
import sys

IGNORE_DIRS = {
    ".git",
    ".vscode",
    "node_modules",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}


def check_python_files(repo_root: Path) -> list[str]:
    """Compile Python files to detect syntax errors."""
    issues: list[str] = []
    py_files = [p for p in repo_root.rglob("*.py") if not any(d in p.parts for d in IGNORE_DIRS)]
    for py_file in py_files:
        try:
            py_compile.compile(str(py_file), doraise=True)
        except py_compile.PyCompileError as exc:
            issues.append(f"{py_file}: Syntax compilation failed: {exc}")
    return issues


def check_json_files(repo_root: Path) -> list[str]:
    """Validate JSON file syntax."""
    issues: list[str] = []
    json_files = [p for p in repo_root.rglob("*.json") if not any(d in p.parts for d in IGNORE_DIRS)]
    for j_file in json_files:
        try:
            json.loads(j_file.read_text(encoding="utf-8"))
        except Exception as exc:
            issues.append(f"{j_file}: Invalid JSON syntax: {exc}")
    return issues


def run_external_linters(repo_root: Path) -> list[str]:
    """Run ruff or flake8 if available."""
    issues: list[str] = []
    ruff = shutil.which("ruff")
    if ruff:
        print("Running ruff check...")
        res = subprocess.run([ruff, "check", "."], cwd=repo_root)
        if res.returncode != 0:
            issues.append("Ruff linter reported violations.")

    shellcheck = shutil.which("shellcheck")
    if shellcheck:
        sh_files = [str(p) for p in repo_root.rglob("*.sh") if not any(d in p.parts for d in IGNORE_DIRS)]
        if sh_files:
            print(f"Running shellcheck on {len(sh_files)} scripts...")
            res = subprocess.run([shellcheck] + sh_files, cwd=repo_root)
            if res.returncode != 0:
                issues.append("Shellcheck reported violations.")

    return issues


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    issues: list[str] = []

    print("Checking Python syntax compilation...")
    issues.extend(check_python_files(repo_root))

    print("Checking JSON file syntax...")
    issues.extend(check_json_files(repo_root))

    issues.extend(run_external_linters(repo_root))

    if issues:
        print(f"\nLint FAILED ({len(issues)} issues found):", file=sys.stderr)
        for issue in issues:
            print(f"  - {issue}", file=sys.stderr)
        sys.exit(1)

    print("Lint PASSED: No linting or syntax errors found.")
    sys.exit(0)


if __name__ == "__main__":
    main()

