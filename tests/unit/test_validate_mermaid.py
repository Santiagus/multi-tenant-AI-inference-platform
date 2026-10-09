"""Unit tests for Mermaid diagram validation."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from scripts.validate_mermaid import (
    MermaidBlock,
    extract_mermaid_blocks,
    validate_mermaid_block,
    validate_mermaid_in_repo,
)


class TestValidateMermaid(unittest.TestCase):
    def test_valid_flowchart_with_dark_theme(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=1,
            lines=[
                (1, "%%{init: {'theme': 'dark'}}%%"),
                (2, "flowchart TD"),
                (3, '    A["React Dashboard"] --> B["Fastify API"]'),
                (4, '    B --> C[("PostgreSQL")]'),
            ],
        )
        issues = validate_mermaid_block(block)
        self.assertEqual(issues, [])

    def test_valid_flowchart_with_subgraphs(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=1,
            lines=[
                (1, "flowchart LR"),
                (2, '    subgraph Ingestion ["Ingestion"]'),
                (3, '        A["API"] --> B["Queue"]'),
                (4, "    end"),
                (5, '    subgraph Execution ["Execution"]'),
                (6, '        B --> C["Worker"]'),
                (7, "    end"),
            ],
        )
        issues = validate_mermaid_block(block)
        self.assertEqual(issues, [])

    def test_empty_mermaid_block(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=10,
            lines=[(10, ""), (11, "   ")],
        )
        issues = validate_mermaid_block(block)
        self.assertTrue(any("empty" in issue.lower() for issue in issues))

    def test_missing_diagram_type(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=5,
            lines=[
                (5, "%%{init: {'theme': 'dark'}}%%"),
                (6, "%% only comments here"),
            ],
        )
        issues = validate_mermaid_block(block)
        self.assertTrue(any("missing mermaid diagram" in issue.lower() for issue in issues))

    def test_unknown_diagram_type(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=1,
            lines=[
                (1, "notADiagramType TD"),
                (2, "    A --> B"),
            ],
        )
        issues = validate_mermaid_block(block)
        self.assertTrue(any("unknown or unsupported" in issue.lower() for issue in issues))

    def test_invalid_flowchart_direction(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=1,
            lines=[
                (1, "flowchart SIDEWAYS"),
                (2, "    A --> B"),
            ],
        )
        issues = validate_mermaid_block(block)
        self.assertTrue(any("invalid flowchart direction" in issue.lower() for issue in issues))

    def test_unclosed_subgraph(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=1,
            lines=[
                (1, "flowchart TD"),
                (2, "    subgraph Workers"),
                (3, '        A["Worker 1"] --> B["Worker 2"]'),
            ],
        )
        issues = validate_mermaid_block(block)
        self.assertTrue(any("unclosed subgraph" in issue.lower() for issue in issues))

    def test_unexpected_end(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=1,
            lines=[
                (1, "flowchart TD"),
                (2, '    A["Worker 1"] --> B["Worker 2"]'),
                (3, "    end"),
            ],
        )
        issues = validate_mermaid_block(block)
        self.assertTrue(any("unexpected 'end'" in issue.lower() for issue in issues))

    def test_invalid_arrow_syntax(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=1,
            lines=[
                (1, "flowchart TD"),
                (2, '    A["Client"] -> B["Server"]'),
            ],
        )
        issues = validate_mermaid_block(block)
        self.assertTrue(any("invalid arrow '->'" in issue.lower() for issue in issues))

    def test_unclosed_quote(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=1,
            lines=[
                (1, "flowchart TD"),
                (2, '    A["Unclosed quote] --> B["Server"]'),
            ],
        )
        issues = validate_mermaid_block(block)
        self.assertTrue(any("unclosed string quote" in issue.lower() for issue in issues))

    def test_mismatched_brackets(self) -> None:
        block = MermaidBlock(
            file_path=Path("test.md"),
            start_line=1,
            lines=[
                (1, "flowchart TD"),
                (2, '    A["Client" --> B["Server"]'),
            ],
        )
        issues = validate_mermaid_block(block)
        self.assertTrue(any("bracket" in issue.lower() for issue in issues))

    def test_extract_mermaid_blocks_from_file(self) -> None:
        markdown_sample = """# Test Title

Some paragraph text.

```mermaid
%%{init: {'theme': 'dark'}}%%
flowchart TD
    A["Source"] --> B["Dest"]
```

Another paragraph.

```mermaid
sequenceDiagram
    Alice->>Bob: Hello
```
"""
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
            f.write(markdown_sample)
            tmp_path = Path(f.name)

        try:
            blocks = extract_mermaid_blocks(tmp_path)
            self.assertEqual(len(blocks), 2)
            self.assertEqual(validate_mermaid_block(blocks[0]), [])
            self.assertEqual(validate_mermaid_block(blocks[1]), [])
        finally:
            if tmp_path.exists():
                tmp_path.unlink()


if __name__ == "__main__":
    unittest.main()

