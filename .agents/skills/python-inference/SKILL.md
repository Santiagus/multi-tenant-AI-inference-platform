---
name: python-inference
description: Python/PyTorch inference workers, model loading/adapters and CPU/GPU execution.
---

# Python/PyTorch Inference

Separate: job transport · model loading · inference execution · artifact handling · telemetry.

Measure rather than claim GPU performance. Support CPU-compatible development when practical.

## Test Generation & Mocking Discipline

- Always import `mock` explicitly via `from unittest import mock` (or `import unittest.mock as mock`). Never rely on bare `import unittest` to access `unittest.mock.*`, because in clean CI environments without preloaded submodules, mypy fails with `Module has no attribute "mock" [attr-defined]`.
- Always provide full type annotations in test helpers, fixtures, and assertion callables.
