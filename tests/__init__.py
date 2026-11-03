"""Automated test suite initialization.

Testing must set mock inference to ENABLE/TRUE/1; no real inference in test is allowed.
"""

from __future__ import annotations

import os

# Enforce generalized mock inference in automated test environments
os.environ["MOCK_INFERENCE"] = "1"
os.environ["INFERENCE_MOCK_MODE"] = "true"
os.environ["NODE_ENV"] = "test"
os.environ["ENV"] = "test"
