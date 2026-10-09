#!/usr/bin/env python3
"""Secret and PII scanning gate.

Executes Gitleaks if available, and performs regex scanning for credentials,
private keys, and sensitive PII patterns across tracked source files.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

# High-risk credential and PII regex patterns
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("AWS Access Key ID", re.compile(r"\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b")),
    (
        "Private Key Header",
        re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"),
    ),
    (
        "Social Security Number (SSN)",
        re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    ),
    (
        "Credit Card Number (16-digit)",
        re.compile(r"\b(?:\d{4}[- ]){3}\d{4}\b"),
    ),
]

EXCLUDED_DIRS = {
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

EXCLUDED_FILES = {
    ".gitleaks.toml",
}


def find_gitleaks_binary() -> str | None:
    """Find gitleaks binary in PATH or standard user directories."""
    found = shutil.which("gitleaks")
    if found:
        return found

    candidates = [
        Path.home() / ".local" / "bin" / "gitleaks",
        Path("/usr/local/bin/gitleaks"),
        Path("/usr/bin/gitleaks"),
    ]
    for c in candidates:
        if c.is_file() and os.access(c, os.X_OK):
            return str(c)

    return None


def run_gitleaks(repo_root: Path) -> int:
    """Run Gitleaks scan against repository."""
    binary = find_gitleaks_binary()
    if not binary:
        print("WARNING: 'gitleaks' binary not found. Skipping Gitleaks execution.")
        return 0

    print(f"Running Gitleaks detection ({binary})...")
    cmd = [
        binary,
        "detect",
        f"--source={repo_root}",
        "--config=.gitleaks.toml",
        "--no-git",
        "--verbose",
    ]
    result = subprocess.run(cmd, cwd=repo_root)
    return result.returncode


def scan_file_for_pii_and_secrets(file_path: Path) -> list[str]:
    """Scan a single text file for prohibited patterns."""
    findings: list[str] = []
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception as exc:
        return [f"{file_path}: Failed to read file: {exc}"]

    lines = content.splitlines()
    for line_idx, line in enumerate(lines, start=1):
        for label, pattern in PATTERNS:
            if pattern.search(line):
                findings.append(f"{file_path}:{line_idx}: Potential {label} detected.")

    return findings


def run_pattern_scan(repo_root: Path) -> list[str]:
    """Walk repository tree and scan text files."""
    findings: list[str] = []
    for root, dirs, files in os.walk(repo_root):
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]
        for f in files:
            if f in EXCLUDED_FILES:
                continue
            path = Path(root) / f
            # Skip symlinks and files larger than 5 MB
            if path.is_symlink() or not path.is_file():
                continue
            if path.stat().st_size > 5 * 1024 * 1024:
                continue
            findings.extend(scan_file_for_pii_and_secrets(path))

    return findings


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent

    print(f"Secret & PII scan starting in {repo_root}...")
    gitleaks_status = run_gitleaks(repo_root)

    print("Running pattern-based credentials and PII scan...")
    pattern_findings = run_pattern_scan(repo_root)

    total_failures = (1 if gitleaks_status != 0 else 0) + len(pattern_findings)

    if pattern_findings:
        print("\nSensitive pattern violations found:", file=sys.stderr)
        for issue in pattern_findings:
            print(f"  - {issue}", file=sys.stderr)

    if total_failures > 0:
        print("\nScan FAILED: Secrets or sensitive patterns detected.", file=sys.stderr)
        sys.exit(1)

    print("Scan PASSED: No secrets or prohibited PII patterns detected.")
    sys.exit(0)


if __name__ == "__main__":
    main()

