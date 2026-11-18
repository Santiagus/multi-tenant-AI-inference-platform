"""Tests for persistent worker helpers and dual-slot resident management."""

from __future__ import annotations

from apps.worker.providers.local import LocalPyTorchAdapter


def test_classify_device_slot_light_vs_heavy() -> None:
    assert LocalPyTorchAdapter.classify_device_slot("openai/whisper-tiny", 150.0, "speech_to_text") == "cpu"
    assert LocalPyTorchAdapter.classify_device_slot("Lightricks/LTX-Video", 10000.0, "media_video") == "gpu"
    assert (
        LocalPyTorchAdapter.classify_device_slot("TinyLlama/TinyLlama-1.1B-Chat-v1.0", 1100.0, "text_to_text") == "cpu"
    )
    assert LocalPyTorchAdapter.classify_device_slot("meta-llama/Llama-3-8B-Instruct", 16.5, "text_to_text") == "gpu"


def test_video_pipeline_cache_hit_sets_warm_flag() -> None:
    adapter = LocalPyTorchAdapter()
    fake_pipe = object()
    adapter._video_pipes["Lightricks/LTX-Video"] = fake_pipe
    got = adapter._get_video_pipeline("Lightricks/LTX-Video", "cuda")
    assert got is fake_pipe
    assert adapter._last_pipe_warm is True
    status = adapter.resident_status()
    assert status["gpu"]["model_id"] == "Lightricks/LTX-Video"
    assert status["gpu"]["warm"] is True


def test_clear_pipes_unloads_resident() -> None:
    adapter = LocalPyTorchAdapter()
    adapter._video_pipes["Lightricks/LTX-Video"] = object()
    adapter._gpu_resident_model_id = "Lightricks/LTX-Video"
    adapter.clear_pipes("gpu")
    assert adapter._video_pipes == {}
    assert adapter._gpu_resident_model_id is None


def test_ensure_single_resident_evicts_other_video() -> None:
    adapter = LocalPyTorchAdapter()
    adapter._video_pipes["model-a"] = object()
    adapter._video_pipes["model-b"] = object()
    adapter._ensure_single_resident_video("model-b")
    assert "model-a" not in adapter._video_pipes
    assert "model-b" in adapter._video_pipes
