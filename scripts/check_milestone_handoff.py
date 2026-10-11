#!/usr/bin/env python3
"""Milestone handoff integrity validator.

Validates milestone protocol adherence as defined in AGENTS.md:
- Fails if a milestone marked `done` in .agents/README.md still contains `_Pending._`.
- Fails if a milestone marked `done` in .agents/README.md contains a `## Progress` section.
- Fails if a milestone marked `done` in .agents/README.md has an `## Outcome` section over 10 lines.
- Fails if an `in-progress` milestone has no `## Progress` section.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys


def parse_milestone_statuses(readme_path: Path) -> dict[str, str]:
    """Parse milestone statuses from .agents/README.md table."""
    if not readme_path.is_file():
        raise FileNotFoundError(f"README not found at {readme_path}")

    content = readme_path.read_text(encoding="utf-8")
    table_pattern = re.compile(r"\|\s*(M\d{2})\s*\|.*?\|\s*(todo|in-progress|done)\s*\|", re.IGNORECASE)

    statuses: dict[str, str] = {}
    for match in table_pattern.finditer(content):
        m_id = match.group(1).upper()
        status = match.group(2).lower()
        statuses[m_id] = status

    if not statuses:
        raise ValueError(f"No milestone rows found in {readme_path}")

    return statuses


def extract_section(content: str, section_name: str) -> str | None:
    """Extract section content between ## <section_name> and the next ## section or EOF."""
    pattern = re.compile(
        rf"^##\s+{re.escape(section_name)}\s*$(.*?)(?=^##\s+|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(content)
    if not match:
        return None
    return match.group(1)


def count_section_lines(section_content: str) -> int:
    """Count non-trivial lines in a section (excluding leading/trailing empty lines)."""
    stripped = section_content.strip()
    if not stripped:
        return 0
    return len(stripped.splitlines())


def validate_milestone(
    milestone_id: str,
    status: str,
    milestone_file: Path,
) -> list[str]:
    """Validate a single milestone against protocol rules."""
    errors: list[str] = []

    if not milestone_file.is_file():
        return [f"[{milestone_id}] Milestone file does not exist: {milestone_file}"]

    content = milestone_file.read_text(encoding="utf-8")
    has_progress = re.search(r"^##\s+Progress\s*$", content, re.MULTILINE) is not None
    outcome = extract_section(content, "Outcome")

    if status == "in-progress":
        if not has_progress:
            errors.append(f"[{milestone_id}] Status is 'in-progress' but missing required '## Progress' section.")

    elif status == "done":
        if has_progress:
            errors.append(f"[{milestone_id}] Status is 'done' but still contains a '## Progress' section.")

        if outcome is None:
            errors.append(f"[{milestone_id}] Status is 'done' but missing '## Outcome' section.")
        else:
            if "_Pending._" in outcome:
                errors.append(f"[{milestone_id}] Status is 'done' but '## Outcome' still contains '_Pending._'.")

            line_count = count_section_lines(outcome)
            if line_count > 10:
                errors.append(
                    f"[{milestone_id}] Status is 'done' but '## Outcome' has {line_count} lines (maximum allowed is 10)."
                )

    elif status == "todo":
        # 'todo' milestones are unstarted; no progress section expected.
        pass
    else:
        errors.append(f"[{milestone_id}] Unknown milestone status: '{status}'.")

    return errors


def validate_test_matrix_sync(
    statuses: dict[str, str],
    test_matrix_path: Path,
) -> list[str]:
    """Ensure completed milestones (M02+) are marked Passed and documented in docs/testing/test-matrix.md."""
    if not test_matrix_path.is_file():
        return []

    errors: list[str] = []
    content = test_matrix_path.read_text(encoding="utf-8")

    for milestone_id, status in statuses.items():
        if status != "done":
            continue

        # Match the full 5-column row: | **MXX** | Scope | Infra | Suites | Status |
        full_row_pattern = re.compile(
            rf"\|\s*\*\*{re.escape(milestone_id)}\*\*\s*\|[^|]+\|[^|]+\|[^|]+\|\s*([^|]+?)\s*\|",
            re.IGNORECASE,
        )
        match = full_row_pattern.search(content)
        if match:
            matrix_status = match.group(1).strip()
            if "passed" not in matrix_status.lower():
                errors.append(
                    f"[{milestone_id}] Status is 'done' in .agents/README.md, but '{test_matrix_path}' lists status as '{matrix_status}' (expected '**Passed**')."
                )

        # For M02+, also require a dedicated 'MXX Verification Matrix' section
        m_num = int(milestone_id[1:]) if milestone_id[1:].isdigit() else 0
        if m_num >= 2 and match:
            section_pattern = re.compile(
                rf"^##\s+.*?{re.escape(milestone_id)}\s+Verification\s+Matrix",
                re.MULTILINE | re.IGNORECASE,
            )
            if not section_pattern.search(content):
                errors.append(
                    f"[{milestone_id}] Status is 'done' in .agents/README.md, but '{test_matrix_path}' is missing a '## ... {milestone_id} Verification Matrix' section."
                )

    return errors


def run_checks(
    readme_path: Path,
    milestones_dir: Path,
    test_matrix_path: Path = Path("docs/testing/test-matrix.md"),
) -> int:
    """Run handoff integrity checks across all milestones."""
    try:
        statuses = parse_milestone_statuses(readme_path)
    except Exception as exc:
        print(f"ERROR: Failed to parse milestone statuses: {exc}", file=sys.stderr)
        return 1

    all_errors: list[str] = []
    checked_count = 0

    for milestone_id, status in statuses.items():
        candidates = list(milestones_dir.glob(f"{milestone_id}-*.md")) + list(
            milestones_dir.glob(f"{milestone_id}.md")
        )
        if not candidates:
            all_errors.append(f"[{milestone_id}] No milestone file matching '{milestone_id}*.md' found in {milestones_dir}.")
            continue

        milestone_file = candidates[0]
        checked_count += 1
        errors = validate_milestone(milestone_id, status, milestone_file)
        all_errors.extend(errors)

    all_errors.extend(validate_test_matrix_sync(statuses, test_matrix_path))

    print(f"Handoff Check: validated {checked_count} milestones against protocol rules.")

    if all_errors:
        print(f"\nFAILED: Found {len(all_errors)} violation(s):", file=sys.stderr)
        for err in all_errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print("SUCCESS: All milestone handoff rules satisfied.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate milestone handoff protocol integrity.")
    parser.add_argument(
        "--readme",
        type=Path,
        default=Path(".agents/README.md"),
        help="Path to .agents/README.md containing milestone status table.",
    )
    parser.add_argument(
        "--milestones-dir",
        type=Path,
        default=Path(".agents/milestones"),
        help="Directory containing milestone markdown specs.",
    )
    parser.add_argument(
        "--test-matrix",
        type=Path,
        default=Path("docs/testing/test-matrix.md"),
        help="Path to docs/testing/test-matrix.md.",
    )
    args = parser.parse_args()

    sys.exit(run_checks(args.readme, args.milestones_dir, args.test_matrix))


if __name__ == "__main__":
    main()


