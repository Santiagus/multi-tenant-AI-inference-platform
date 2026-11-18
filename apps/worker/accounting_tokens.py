"""Modality-aware token-factory accounting for enterprise in/out metrics.

Text uses tokenizer counts. Image/video use catalog-style latent / spatio-temporal
tokens (MLPerf / VBench style) so FinOps keeps a uniform tokens_in / tokens_out shape.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AccountingResult:
    tokens_in: int
    tokens_out: int
    token_accounting: str  # tokenizer | latent | spatiotemporal | asr | synthetic
    token_unit_label: str


@dataclass(frozen=True)
class MediaReferenceProfile:
    """Reference geometry that defines catalog referenceTaskTokens."""

    width: int
    height: int
    steps: int
    frames: int
    reference_task_tokens: int
    accounting: str
    unit_label: str


# Mirrors apps/dashboard MODEL_PUBLIC_BENCHMARKS reference profiles (evidence: estimated catalog).
MEDIA_REFERENCE_PROFILES: dict[str, MediaReferenceProfile] = {
    "black-forest-labs/flux.1-schnell": MediaReferenceProfile(
        width=1024,
        height=1024,
        steps=4,
        frames=1,
        reference_task_tokens=4096,
        accounting="latent",
        unit_label="latent patch tokens",
    ),
    "stabilityai/sd-turbo": MediaReferenceProfile(
        width=512,
        height=512,
        steps=2,
        frames=1,
        reference_task_tokens=1024,
        accounting="latent",
        unit_label="latent patch tokens",
    ),
    "stabilityai/stable-diffusion-xl-base-1.0": MediaReferenceProfile(
        width=1024,
        height=1024,
        steps=20,
        frames=1,
        reference_task_tokens=4096,
        accounting="latent",
        unit_label="latent patch tokens",
    ),
    "lightricks/ltx-video": MediaReferenceProfile(
        # Packaged default-ish: 704x480, 161 frames, 30 steps → ~24k spatiotemporal tokens.
        width=704,
        height=480,
        steps=30,
        frames=161,
        reference_task_tokens=24_000,
        accounting="spatiotemporal",
        unit_label="spatio-temporal tokens",
    ),
    "wan-ai/wan2.1-t2v-1.3b": MediaReferenceProfile(
        width=640,
        height=368,
        steps=30,
        frames=72,
        reference_task_tokens=12_000,
        accounting="spatiotemporal",
        unit_label="spatio-temporal tokens",
    ),
    "wan-ai/wan2.1-t2v-1.3b-diffusers": MediaReferenceProfile(
        width=640,
        height=368,
        steps=30,
        frames=72,
        reference_task_tokens=12_000,
        accounting="spatiotemporal",
        unit_label="spatio-temporal tokens",
    ),
    "thudm/cogvideox-2b": MediaReferenceProfile(
        width=720,
        height=480,
        steps=50,
        frames=49,
        reference_task_tokens=10_000,
        accounting="spatiotemporal",
        unit_label="spatio-temporal tokens",
    ),
}


def _prompt_tokens(prompt: str) -> int:
    trimmed = prompt.strip()
    if not trimmed:
        return 1
    # ~4 chars/token heuristic when tokenizer unavailable (media conditioning).
    return max(1, (len(trimmed) + 3) // 4)


def resolve_media_profile(model_id: str, modality: str) -> MediaReferenceProfile:
    key = model_id.strip().lower()
    if key in MEDIA_REFERENCE_PROFILES:
        return MEDIA_REFERENCE_PROFILES[key]
    if "flux" in key:
        return MEDIA_REFERENCE_PROFILES["black-forest-labs/flux.1-schnell"]
    if "sd-turbo" in key or "stable-diffusion" in key:
        return MEDIA_REFERENCE_PROFILES["stabilityai/sd-turbo"]
    if "ltx" in key:
        return MEDIA_REFERENCE_PROFILES["lightricks/ltx-video"]
    if "wan" in key:
        return MEDIA_REFERENCE_PROFILES["wan-ai/wan2.1-t2v-1.3b"]
    if "cogvideo" in key:
        return MEDIA_REFERENCE_PROFILES["thudm/cogvideox-2b"]
    if modality == "media_video":
        return MEDIA_REFERENCE_PROFILES["lightricks/ltx-video"]
    return MEDIA_REFERENCE_PROFILES["stabilityai/sd-turbo"]


def account_image_tokens(
    *,
    model_id: str,
    prompt: str,
    width: int,
    height: int,
    steps: int,
) -> AccountingResult:
    profile = resolve_media_profile(model_id, "text_to_image")
    ref_area = max(profile.width * profile.height, 1)
    area = max(int(width) * int(height), 1)
    scale = (area / ref_area) * (max(int(steps), 1) / max(profile.steps, 1))
    tokens_out = max(1, int(round(profile.reference_task_tokens * scale)))
    return AccountingResult(
        tokens_in=_prompt_tokens(prompt),
        tokens_out=tokens_out,
        token_accounting=profile.accounting,
        token_unit_label=profile.unit_label,
    )


def account_video_tokens(
    *,
    model_id: str,
    prompt: str,
    width: int,
    height: int,
    frames: int,
    steps: int,
) -> AccountingResult:
    profile = resolve_media_profile(model_id, "media_video")
    ref_vol = max(profile.width * profile.height * profile.frames, 1)
    vol = max(int(width) * int(height) * int(frames), 1)
    scale = (vol / ref_vol) * (max(int(steps), 1) / max(profile.steps, 1))
    tokens_out = max(1, int(round(profile.reference_task_tokens * scale)))
    return AccountingResult(
        tokens_in=_prompt_tokens(prompt),
        tokens_out=tokens_out,
        token_accounting=profile.accounting,
        token_unit_label=profile.unit_label,
    )


def account_text_tokens(*, tokens_in: int, tokens_out: int) -> AccountingResult:
    return AccountingResult(
        tokens_in=max(1, int(tokens_in)),
        tokens_out=max(1, int(tokens_out)),
        token_accounting="tokenizer",
        token_unit_label="tokenizer tokens",
    )


def account_asr_tokens(*, prompt: str, transcript: str) -> AccountingResult:
    return AccountingResult(
        tokens_in=_prompt_tokens(prompt),
        tokens_out=max(1, len(transcript.split())),
        token_accounting="asr",
        token_unit_label="ASR transcript tokens",
    )


def accounting_metadata(result: AccountingResult) -> dict[str, Any]:
    return {
        "token_accounting": result.token_accounting,
        "token_unit_label": result.token_unit_label,
    }
