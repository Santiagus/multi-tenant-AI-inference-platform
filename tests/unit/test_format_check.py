from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from scripts.format_check import check_file_formatting


class TestFormatCheck(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dir_path = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_clean_file_passes(self) -> None:
        test_file = self.dir_path / "clean.md"
        test_file.write_text("# Title\n\nRelative link: [doc](doc.md)\n", encoding="utf-8")
        issues = check_file_formatting(test_file)
        self.assertEqual(issues, [])

    def test_absolute_machine_path_detected(self) -> None:
        test_file = self.dir_path / "bad.md"
        # Simulate an absolute home directory path
        bad_content = "# Title\n\nLink: [bad](" + "file:///home/" + "user/repo/doc.md)\n"
        test_file.write_text(bad_content, encoding="utf-8")
        issues = check_file_formatting(test_file)
        self.assertTrue(any("Machine-specific absolute path detected" in issue for issue in issues))

    def test_missing_newline_detected(self) -> None:
        test_file = self.dir_path / "no_newline.py"
        test_file.write_bytes(b"x = 1")
        issues = check_file_formatting(test_file)
        self.assertTrue(any("Missing final newline" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()

