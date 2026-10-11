"""Hardware and VRAM telemetry collector for GPU and CPU inference execution."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from typing import Any

from apps.worker.contracts import HardwareTelemetry


def _try_import_torch() -> Any | None:
    try:
        import torch  # type: ignore[import-not-found]

        return torch
    except Exception:
        return None


def _try_import_psutil() -> Any | None:
    try:
        import psutil  # type: ignore[import-untyped]

        return psutil
    except Exception:
        return None


class TelemetryCollector:
    """Collects VRAM, GPU utilization, and host process RAM telemetry."""

    def __init__(self, torch_module: Any | None = None, psutil_module: Any | None = None) -> None:
        self._torch = torch_module if torch_module is not None else _try_import_torch()
        self._psutil = psutil_module if psutil_module is not None else _try_import_psutil()

    def is_cuda_available(self) -> bool:
        if self._torch is None:
            return False
        try:
            return bool(self._torch.cuda.is_available())
        except Exception:
            return False

    def is_torch_available(self) -> bool:
        return self._torch is not None

    def reset_peak_memory(self) -> None:
        """Reset CUDA peak memory statistics prior to an inference pass if CUDA is active."""
        if self.is_cuda_available() and self._torch is not None:
            try:
                self._torch.cuda.reset_peak_memory_stats()
            except Exception:
                pass

    def get_process_rss_mb(self) -> float:
        """Return current process RSS memory in MiB."""
        if self._psutil is not None:
            try:
                proc = self._psutil.Process(os.getpid())
                return round(float(proc.memory_info().rss) / (1024 * 1024), 2)
            except Exception:
                pass
        return 0.0

    def get_cpu_name(self) -> str:
        """Return human-readable CPU model string."""
        try:
            cpuinfo = "/proc/cpuinfo"
            if os.path.isfile(cpuinfo):
                with open(cpuinfo, encoding="utf-8") as f:
                    for line in f:
                        if line.lower().startswith("model name"):
                            parts = line.split(":", 1)
                            if len(parts) == 2 and parts[1].strip():
                                return parts[1].strip()
        except Exception:
            pass
        proc = platform.processor()
        return proc if proc else platform.machine() or "Generic-CPU"

    def query_nvidia_smi_utilization(self) -> float | None:
        """Query GPU compute utilization percentage via nvidia-smi when available."""
        nvidia_smi = shutil.which("nvidia-smi")
        if not nvidia_smi:
            return None
        try:
            res = subprocess.run(
                [nvidia_smi, "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=2.0,
                check=False,
            )
            if res.returncode == 0 and res.stdout.strip():
                first_line = res.stdout.strip().splitlines()[0].strip()
                return round(float(first_line), 1)
        except Exception:
            pass
        return None

    def capture_snapshot(self, active_backend: str, model_footprint_mb: float = 0.0) -> HardwareTelemetry:
        """Capture a point-in-time hardware telemetry snapshot."""
        rss_mb = self.get_process_rss_mb()

        if self.is_cuda_available() and self._torch is not None:
            device_idx = 0
            device_name = str(self._torch.cuda.get_device_name(device_idx))
            alloc_mb = round(float(self._torch.cuda.memory_allocated(device_idx)) / (1024 * 1024), 2)
            reserved_mb = round(float(self._torch.cuda.memory_reserved(device_idx)) / (1024 * 1024), 2)
            peak_mb = round(float(self._torch.cuda.max_memory_allocated(device_idx)) / (1024 * 1024), 2)
            props = self._torch.cuda.get_device_properties(device_idx)
            total_mb = round(float(getattr(props, "total_memory", 0)) / (1024 * 1024), 2)
            gpu_util = self.query_nvidia_smi_utilization()
            return HardwareTelemetry(
                device_type="cuda",
                device_name=device_name,
                backend=active_backend,
                vram_allocated_mb=max(alloc_mb, model_footprint_mb),
                vram_reserved_mb=max(reserved_mb, model_footprint_mb),
                vram_peak_mb=max(peak_mb, model_footprint_mb),
                vram_total_mb=total_mb,
                gpu_utilization_pct=gpu_util,
                ram_rss_mb=rss_mb,
                measurement_mode="measured",
            )

        return HardwareTelemetry(
            device_type="cpu",
            device_name=self.get_cpu_name(),
            backend=active_backend,
            vram_allocated_mb=0.0,
            vram_reserved_mb=0.0,
            vram_peak_mb=0.0,
            vram_total_mb=0.0,
            gpu_utilization_pct=None,
            ram_rss_mb=max(rss_mb, round(model_footprint_mb, 2)),
            measurement_mode="measured",
        )

