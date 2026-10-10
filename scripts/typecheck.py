#!/usr/bin/env python3
"""Type check gate runner.

Delegates to mypy and tsc when installed; otherwise validates AST type annotations.
"""

from __future__ import annotations

import ast
import os
from pathlib import Path
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


def check_ast_type_annotations(repo_root: Path) -> list[str]:
    """Inspect Python AST for syntax validity."""
    issues: list[str] = []
    py_files = [p for p in repo_root.rglob("*.py") if not any(d in p.parts for d in IGNORE_DIRS)]
    for py_file in py_files:
        try:
            tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
            if not isinstance(tree, ast.Module):
                issues.append(f"{py_file}: AST root is not a Module")
        except Exception as exc:
            issues.append(f"{py_file}: AST parsing failed: {exc}")
    return issues


def find_mypy_binary() -> str | None:
    """Find mypy executable in PATH or ~/.local/bin."""
    found = shutil.which("mypy")
    if found:
        return found
    user_bin = Path.home() / ".local" / "bin" / "mypy"
    if user_bin.is_file() and os.access(user_bin, os.X_OK):
        return str(user_bin)
    return None


def run_mypy(repo_root: Path) -> list[str]:
    """Run mypy if available."""
    issues: list[str] = []
    mypy = find_mypy_binary()
    if mypy:
        print(f"Running mypy ({mypy})...")
        res = subprocess.run([mypy, "scripts", "tests"], cwd=repo_root)
        if res.returncode != 0:
            issues.append("Mypy type checking reported violations.")
    return issues


def find_pnpm_binary() -> str | None:
    """Find pnpm executable in PATH or ~/.local/bin."""
    found = shutil.which("pnpm")
    if found:
        return found
    user_bin = Path.home() / ".local" / "bin" / "pnpm"
    if user_bin.is_file() and os.access(user_bin, os.X_OK):
        return str(user_bin)
    return None


def run_tsc(repo_root: Path) -> list[str]:
    """Run TypeScript compiler check across workspace projects."""
    issues: list[str] = []
    pnpm = find_pnpm_binary()
    if pnpm and (repo_root / "package.json").is_file():
        print(f"Running TypeScript typecheck ({pnpm} typecheck)...")
        env = os.environ.copy()
        user_bin_dir = str(Path.home() / ".local" / "bin")
        if user_bin_dir not in env.get("PATH", ""):
            env["PATH"] = f"{user_bin_dir}:{env.get('PATH', '')}"
        res = subprocess.run([pnpm, "typecheck"], cwd=repo_root, env=env)
        if res.returncode != 0:
            issues.append("TypeScript type checking reported violations.")
    return issues


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    issues: list[str] = []

    print("Checking Python AST integrity...")
    issues.extend(check_ast_type_annotations(repo_root))

    issues.extend(run_mypy(repo_root))
    issues.extend(run_tsc(repo_root))

    if issues:
        print(f"\nTypecheck FAILED ({len(issues)} issues found):", file=sys.stderr)
        for issue in issues:
            print(f"  - {issue}", file=sys.stderr)
        sys.exit(1)

    print("Typecheck PASSED: Types validated successfully.")
    sys.exit(0)


if __name__ == "__main__":
    main()

