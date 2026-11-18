"""Unit tests for modality token-factory accounting."""

from __future__ import annotations

import unittest

from apps.worker.accounting_tokens import (
    account_image_tokens,
    account_video_tokens,
    resolve_media_profile,
)


class AccountingTokensTests(unittest.TestCase):
    def test_ltx_profile_resolves(self) -> None:
        profile = resolve_media_profile("Lightricks/LTX-Video", "media_video")
        self.assertEqual(profile.accounting, "spatiotemporal")
        self.assertGreater(profile.reference_task_tokens, 0)

    def test_image_scales_with_resolution(self) -> None:
        small = account_image_tokens(
            model_id="stabilityai/sd-turbo",
            prompt="a red cube",
            width=512,
            height=512,
            steps=2,
        )
        large = account_image_tokens(
            model_id="stabilityai/sd-turbo",
            prompt="a red cube",
            width=1024,
            height=1024,
            steps=2,
        )
        self.assertEqual(small.token_accounting, "latent")
        self.assertGreater(large.tokens_out, small.tokens_out)

    def test_video_out_tokens_track_frames(self) -> None:
        short = account_video_tokens(
            model_id="Lightricks/LTX-Video",
            prompt="coastal road",
            width=544,
            height=320,
            frames=49,
            steps=12,
        )
        long = account_video_tokens(
            model_id="Lightricks/LTX-Video",
            prompt="coastal road",
            width=544,
            height=320,
            frames=161,
            steps=12,
        )
        self.assertEqual(short.token_accounting, "spatiotemporal")
        self.assertGreater(long.tokens_out, short.tokens_out)
        self.assertGreater(short.tokens_in, 0)


if __name__ == "__main__":
    unittest.main()
