#!/usr/bin/env python3
"""Format validation checker.

Enforces whitespace, end-of-line LF, and trailing newline conventions
defined in .editorconfig. Also invokes ruff/prettier if available.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
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

CHECKED_EXTENSIONS = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".sh",
    ".md",
}


def check_file_formatting(path: Path) -> list[str]:
    """Check line endings, EOF newline, and trailing whitespace."""
    issues: list[str] = []
    try:
        raw_bytes = path.read_bytes()
    except Exception as exc:
        return [f"{path}: Cannot read file: {exc}"]

    # Skip empty files
    if not raw_bytes:
        return []

    # Check CRLF
    if b"\r\n" in raw_bytes:
        issues.append(f"{path}: Contains CRLF line endings (LF required)")

    # Check trailing newline
    if not raw_bytes.endswith(b"\n"):
        issues.append(f"{path}: Missing final newline at end of file")

    # Check trailing whitespace (skip markdown where 2 trailing spaces denote line breaks)
    if path.suffix != ".md":
        lines = raw_bytes.split(b"\n")
        for idx, line in enumerate(lines, start=1):
            if line.rstrip(b"\r") != line.rstrip():
                # Line has trailing whitespace
                issues.append(f"{path}:{idx}: Trailing whitespace detected")

    # Check for machine-specific absolute user paths
    if path.name != "format_check.py":
        try:
            text = raw_bytes.decode("utf-8")
            abs_pattern = re.compile(r"(?:file://)?/(?:home|Users)/[a-zA-Z0-9_-]+")
            for line_no, text_line in enumerate(text.splitlines(), start=1):
                if abs_pattern.search(text_line):
                    issues.append(f"{path}:{line_no}: Machine-specific absolute path detected (use repo-relative paths)")
        except UnicodeDecodeError:
            pass

    return issues


def run_ruff_format(repo_root: Path) -> int:
    """Run ruff format check if ruff is installed."""
    ruff = shutil.which("ruff")
    if not ruff:
        return 0

    print("Running ruff format --check...")
    result = subprocess.run([ruff, "format", "--check", "."], cwd=repo_root)
    return result.returncode


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    all_issues: list[str] = []

    for root, dirs, files in os.walk(repo_root):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for f in files:
            path = Path(root) / f
            if path.suffix in CHECKED_EXTENSIONS or f in {"Makefile", ".editorconfig", ".gitignore", ".gitmessage"}:
                all_issues.extend(check_file_formatting(path))

    ruff_status = run_ruff_format(repo_root)
    if ruff_status != 0:
        all_issues.append("Ruff format check failed.")

    if all_issues:
        print(f"Format Check FAILED ({len(all_issues)} issues found):", file=sys.stderr)
        for issue in all_issues:
            print(f"  - {issue}", file=sys.stderr)
        sys.exit(1)

    print("Format Check PASSED: All checked files conform to formatting standards.")
    sys.exit(0)


if __name__ == "__main__":
    main()

