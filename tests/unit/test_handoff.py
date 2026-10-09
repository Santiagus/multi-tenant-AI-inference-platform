"""Unit tests for milestone handoff protocol checker."""

import tempfile
import unittest
from pathlib import Path

from scripts.check_milestone_handoff import (
    count_section_lines,
    extract_section,
    parse_milestone_statuses,
    validate_milestone,
)


class TestMilestoneHandoffValidator(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_parse_milestone_statuses(self) -> None:
        readme_file = self.base_path / "README.md"
        readme_file.write_text(
            """
| ID | Milestone | Primary outcome | Status |
|---|---|---|---|
| M00 | GitHub Foundation | Monorepo layout | done |
| M01 | Architecture | Target architecture | in-progress |
| M02 | Skeleton | Containers | todo |
""",
            encoding="utf-8",
        )
        statuses = parse_milestone_statuses(readme_file)
        self.assertEqual(
            statuses,
            {"M00": "done", "M01": "in-progress", "M02": "todo"},
        )

    def test_in_progress_missing_progress_fails(self) -> None:
        milestone_file = self.base_path / "M00-test.md"
        milestone_file.write_text(
            """# M00 - Test
## Objective
Something
## Outcome
_Pending._
""",
            encoding="utf-8",
        )
        errors = validate_milestone("M00", "in-progress", milestone_file)
        self.assertEqual(len(errors), 1)
        self.assertIn("missing required '## Progress' section", errors[0])

    def test_in_progress_with_progress_passes(self) -> None:
        milestone_file = self.base_path / "M00-test.md"
        milestone_file.write_text(
            """# M00 - Test
## Progress
- [ ] Task 1
## Outcome
_Pending._
""",
            encoding="utf-8",
        )
        errors = validate_milestone("M00", "in-progress", milestone_file)
        self.assertEqual(errors, [])

    def test_done_with_pending_outcome_fails(self) -> None:
        milestone_file = self.base_path / "M00-test.md"
        milestone_file.write_text(
            """# M00 - Test
## Outcome
_Pending._
""",
            encoding="utf-8",
        )
        errors = validate_milestone("M00", "done", milestone_file)
        self.assertEqual(len(errors), 1)
        self.assertIn("still contains '_Pending._'", errors[0])

    def test_done_with_progress_section_fails(self) -> None:
        milestone_file = self.base_path / "M00-test.md"
        milestone_file.write_text(
            """# M00 - Test
## Progress
- [x] Task 1
## Outcome
All good.
""",
            encoding="utf-8",
        )
        errors = validate_milestone("M00", "done", milestone_file)
        self.assertEqual(len(errors), 1)
        self.assertIn("still contains a '## Progress' section", errors[0])

    def test_done_with_outcome_over_10_lines_fails(self) -> None:
        long_outcome = "\n".join(f"Line {i}" for i in range(1, 13))
        milestone_file = self.base_path / "M00-test.md"
        milestone_file.write_text(
            f"""# M00 - Test
## Outcome
{long_outcome}
""",
            encoding="utf-8",
        )
        errors = validate_milestone("M00", "done", milestone_file)
        self.assertEqual(len(errors), 1)
        self.assertIn("has 12 lines (maximum allowed is 10)", errors[0])

    def test_done_valid_outcome_passes(self) -> None:
        milestone_file = self.base_path / "M00-test.md"
        milestone_file.write_text(
            """# M00 - Test
## Outcome
- Delivered monorepo skeleton.
- Local CI gate operational.
""",
            encoding="utf-8",
        )
        errors = validate_milestone("M00", "done", milestone_file)
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()

