#!/usr/bin/env python3
"""Validation utility for Mermaid diagram syntax embedded in Markdown documents."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import NamedTuple

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

VALID_DIAGRAM_TYPES = {
    "flowchart",
    "graph",
    "sequencediagram",
    "classdiagram",
    "statediagram",
    "statediagram-v2",
    "erdiagram",
    "journey",
    "gantt",
    "pie",
    "quadrantchart",
    "requirementdiagram",
    "gitgraph",
    "mindmap",
    "timeline",
    "sankey-beta",
    "xychart-beta",
    "block-beta",
    "architecture-beta",
    "packet-beta",
    "c4context",
    "c4container",
    "c4component",
    "c4dynamic",
    "c4deployment",
}

VALID_FLOWCHART_DIRECTIONS = {"TB", "TD", "BT", "RL", "LR"}


class MermaidBlock(NamedTuple):
    file_path: Path
    start_line: int
    lines: list[tuple[int, str]]  # (file_line_number, line_content)


def extract_mermaid_blocks(file_path: Path) -> list[MermaidBlock]:
    """Extract all ```mermaid ... ``` code blocks from a markdown file."""
    blocks: list[MermaidBlock] = []
    try:
        content = file_path.read_text(encoding="utf-8")
    except Exception as exc:
        print(f"Error reading {file_path}: {exc}", file=sys.stderr)
        return blocks

    in_mermaid = False
    current_lines: list[tuple[int, str]] = []
    start_line = 0

    for idx, line in enumerate(content.splitlines(), start=1):
        stripped = line.strip()
        if not in_mermaid:
            if stripped.startswith("```mermaid"):
                in_mermaid = True
                start_line = idx
                current_lines = []
        else:
            if stripped.startswith("```"):
                blocks.append(MermaidBlock(file_path=file_path, start_line=start_line, lines=current_lines))
                in_mermaid = False
                current_lines = []
            else:
                current_lines.append((idx, line))

    if in_mermaid:
        # Unclosed code fence
        blocks.append(MermaidBlock(file_path=file_path, start_line=start_line, lines=current_lines))

    return blocks


def validate_directive(line: str) -> list[str]:
    """Validate Mermaid directive like %%{init: {'theme': 'dark'}}%%."""
    issues: list[str] = []
    stripped = line.strip()
    if not (stripped.startswith("%%{") and stripped.endswith("}%%")):
        issues.append(f"Malformed Mermaid directive '{stripped}': must begin with '%%{{' and end with '}}%%'")
        return issues

    body = stripped[3:-3].strip()
    if not body:
        issues.append("Empty directive body inside '%%{...}%%'")
        return issues

    # Common directive is init: {...}
    if body.startswith("init:"):
        json_candidate = body[5:].strip()
        # In mermaid directives, single quotes are often used instead of double quotes for JSON
        # Convert single to double quotes for basic JSON syntax validation if needed
        json_normalized = json_candidate.replace("'", '"')
        try:
            parsed = json.loads(json_normalized)
            if not isinstance(parsed, dict):
                issues.append(f"Directive init body must be an object/dict: '{json_candidate}'")
        except json.JSONDecodeError as exc:
            issues.append(f"Invalid JSON/dict in directive '{json_candidate}': {exc}")

    return issues


def validate_flowchart_line(line: str, line_no: int) -> list[str]:
    """Check common syntax pitfalls in flowchart/graph statements."""
    issues: list[str] = []
    stripped = line.strip()

    # Skip comments
    if stripped.startswith("%%"):
        return issues

    # Check unclosed quotes
    # Count unescaped quotes
    in_quotes = False
    quote_count = 0
    i = 0
    while i < len(line):
        if line[i] == '"' and (i == 0 or line[i - 1] != "\\"):
            quote_count += 1
            in_quotes = not in_quotes
        i += 1

    if in_quotes:
        issues.append(f"Line {line_no}: Unclosed string quote in '{stripped}'")
        return issues

    # Outside quotes, check invalid arrow syntax like single ' -> '
    # In Mermaid flowchart, ' -> ' is invalid (must be ' --> ' or ' -.-> ' or ' ==> ')
    # Mask out quoted strings first
    outside_quotes = re.sub(r'"[^"\\]*(?:\\.[^"\\]*)*"', '""', line)

    # Disallow naked ' -> ' (allowing '-->', '-.->', '==>')
    if re.search(r'(?<![-.=])\s*->\s*(?!>)', outside_quotes):
        issues.append(
            f"Line {line_no}: Invalid arrow '->' in '{stripped}'; Mermaid flowcharts require '-->' or '==>' or '-.->'"
        )

    # Check bracket balance outside quotes
    bracket_stack: list[str] = []
    bracket_map = {"]": "[", ")": "(", "}": "{"}
    open_brackets = {"[", "(", "{"}

    for char in outside_quotes:
        if char in open_brackets:
            bracket_stack.append(char)
        elif char in bracket_map:
            expected = bracket_map[char]
            if not bracket_stack or bracket_stack[-1] != expected:
                issues.append(f"Line {line_no}: Mismatched bracket '{char}' in '{stripped}'")
                break
            bracket_stack.pop()

    if bracket_stack:
        issues.append(f"Line {line_no}: Unclosed bracket(s) '{''.join(bracket_stack)}' in '{stripped}'")

    return issues


def validate_mermaid_block(block: MermaidBlock) -> list[str]:
    """Validate a single Mermaid block."""
    issues: list[str] = []
    file_path = block.file_path

    # Filter non-empty lines
    non_empty = [(no, l) for no, l in block.lines if l.strip()]
    if not non_empty:
        issues.append(f"{file_path}:{block.start_line}: Mermaid code block is empty")
        return issues

    # Find the header line declaring diagram type, skipping directives and comments
    header_idx = -1
    for idx, (line_no, line) in enumerate(non_empty):
        stripped = line.strip()
        if stripped.startswith("%%{"):
            directive_issues = validate_directive(stripped)
            for di in directive_issues:
                issues.append(f"{file_path}:{line_no}: {di}")
            continue
        if stripped.startswith("%%"):
            continue
        header_idx = idx
        break

    if header_idx == -1:
        issues.append(f"{file_path}:{block.start_line}: Missing Mermaid diagram declaration")
        return issues

    header_line_no, header_line = non_empty[header_idx]
    header_parts = header_line.strip().split()
    diagram_type = header_parts[0].lower()

    if diagram_type not in VALID_DIAGRAM_TYPES:
        issues.append(
            f"{file_path}:{header_line_no}: Unknown or unsupported Mermaid diagram type '{header_parts[0]}'"
        )
        return issues

    # Validate flowchart/graph specific rules
    if diagram_type in {"flowchart", "graph"}:
        if len(header_parts) > 1:
            direction = header_parts[1].upper()
            if direction not in VALID_FLOWCHART_DIRECTIONS:
                issues.append(
                    f"{file_path}:{header_line_no}: Invalid flowchart direction '{header_parts[1]}'. "
                    f"Must be one of: {', '.join(sorted(VALID_FLOWCHART_DIRECTIONS))}"
                )

        subgraph_depth = 0
        for line_no, line in non_empty[header_idx + 1:]:
            stripped = line.strip()
            if stripped.startswith("subgraph"):
                subgraph_depth += 1
            elif stripped == "end" or stripped.startswith("end "):
                if subgraph_depth <= 0:
                    issues.append(f"{file_path}:{line_no}: Unexpected 'end' without matching 'subgraph'")
                else:
                    subgraph_depth -= 1

            line_issues = validate_flowchart_line(line, line_no)
            for li in line_issues:
                issues.append(f"{file_path}: {li}")

        if subgraph_depth > 0:
            issues.append(
                f"{file_path}:{block.start_line}: Unclosed subgraph block(s): {subgraph_depth} 'end' tag(s) missing"
            )

    return issues


def validate_with_mmdc(blocks: list[MermaidBlock]) -> list[str]:
    """If mmdc (Mermaid CLI) is installed, run it on each block."""
    mmdc = shutil.which("mmdc")
    if not mmdc:
        return []

    issues: list[str] = []
    import tempfile

    for block in blocks:
        block_text = "\n".join(l for _, l in block.lines)
        with tempfile.NamedTemporaryFile("w", suffix=".mmd", delete=False, encoding="utf-8") as f:
            f.write(block_text)
            temp_path = f.name

        try:
            res = subprocess.run(
                [mmdc, "-i", temp_path, "-o", "/dev/null"],
                capture_output=True,
                text=True,
                timeout=15,
            )
            if res.returncode != 0:
                issues.append(
                    f"{block.file_path}:{block.start_line}: mmdc compiler validation failed: {res.stderr.strip()}"
                )
        except Exception as exc:
            issues.append(f"{block.file_path}:{block.start_line}: Error executing mmdc: {exc}")
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    return issues


def validate_mermaid_in_repo(repo_root: Path) -> tuple[int, list[str]]:
    """Scan all markdown files in repo and validate mermaid blocks."""
    all_issues: list[str] = []
    total_blocks = 0

    md_files = [
        p for p in repo_root.rglob("*.md")
        if not any(d in p.parts for d in IGNORE_DIRS)
    ]

    all_blocks: list[MermaidBlock] = []
    for md_file in md_files:
        blocks = extract_mermaid_blocks(md_file)
        all_blocks.extend(blocks)
        total_blocks += len(blocks)
        for block in blocks:
            all_issues.extend(validate_mermaid_block(block))

    # Also run mmdc if available
    if all_blocks:
        all_issues.extend(validate_with_mmdc(all_blocks))

    return total_blocks, all_issues


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    if len(sys.argv) > 1 and sys.argv[1] not in {"--check-all", "--all"}:
        target_path = Path(sys.argv[1]).resolve()
        if target_path.is_file():
            blocks = extract_mermaid_blocks(target_path)
            issues: list[str] = []
            for b in blocks:
                issues.extend(validate_mermaid_block(b))
            issues.extend(validate_with_mmdc(blocks))
            total_blocks = len(blocks)
        else:
            print(f"Error: File not found: {target_path}", file=sys.stderr)
            sys.exit(1)
    else:
        total_blocks, issues = validate_mermaid_in_repo(repo_root)

    print(f"Validated {total_blocks} Mermaid diagram block(s)...")

    if issues:
        print(f"\nMermaid validation FAILED ({len(issues)} issues found):", file=sys.stderr)
        for issue in issues:
            print(f"  - {issue}", file=sys.stderr)
        sys.exit(1)

    print("Mermaid validation PASSED: All diagrams valid.")
    sys.exit(0)


if __name__ == "__main__":
    main()

