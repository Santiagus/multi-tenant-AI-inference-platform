"""Local Hugging Face hub cache inventory and ensure/download helpers.

CLI:
  python -m apps.worker.model_cache list --models org/name,org/other
  python -m apps.worker.model_cache ensure --model org/name
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Any


def resolve_hub_model_id(model_id: str) -> str:
    """Map dashboard catalog IDs to the Hub repo that actually stores weights."""
    mid = model_id.strip()
    aliases = {
        "wan-ai/wan2.1-t2v-1.3b": "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
        "wan-ai/wan2.1-t2v-1.3b-diffusers": "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
        # Canonical FLUX.1 schnell → local NF4 pack that fits 16 GB VRAM
        "black-forest-labs/flux.1-schnell": "magespace/FLUX.1-schnell-bnb-nf4",
        "lightricks/ltx-video": "Lightricks/LTX-Video",
        "ltx-video": "Lightricks/LTX-Video",
        "meta-llama/llama-3-8b-instruct": "meta-llama/Meta-Llama-3-8B-Instruct",
        "meta-llama/llama-3-8b": "meta-llama/Meta-Llama-3-8B",
    }
    mapped = aliases.get(mid.lower())
    if mapped:
        return mapped
    if "wan" in mid.lower() and "diffusers" not in mid.lower():
        return f"{mid}-Diffusers"
    return mid


def _hub_cache_path() -> Path:
    hf_home = os.environ.get("HF_HOME") or os.environ.get("HUGGINGFACE_HUB_CACHE")
    if hf_home:
        p = Path(hf_home)
        # HUGGINGFACE_HUB_CACHE may already point at .../hub
        if p.name == "hub":
            return p
        return p / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _repo_folder_name(repo_id: str) -> str:
    return "models--" + repo_id.replace("/", "--")


def _scan_cached_repos() -> dict[str, dict[str, Any]]:
    """Return map hub_id -> {size_bytes, path, revision}."""
    out: dict[str, dict[str, Any]] = {}
    try:
        from huggingface_hub import scan_cache_dir  # type: ignore[import-not-found]
    except Exception as exc:
        sys.stderr.write(f"[MODEL_CACHE] huggingface_hub unavailable: {exc}\n")
        return out

    try:
        info = scan_cache_dir()
    except Exception as exc:
        sys.stderr.write(f"[MODEL_CACHE] scan_cache_dir failed: {exc}\n")
        return out

    for repo in info.repos:
        repo_type = str(getattr(repo, "repo_type", "model")).lower()
        if "dataset" in repo_type or "space" in repo_type:
            continue
        revisions = list(getattr(repo, "revisions", []) or [])
        rev = revisions[0].commit_hash if revisions else None
        out[str(repo.repo_id)] = {
            "hub_id": str(repo.repo_id),
            "cached": True,
            "size_bytes": int(getattr(repo, "size_on_disk", 0) or 0),
            "files": int(getattr(repo, "nb_files", 0) or 0),
            "revision": rev,
            "path": str(getattr(repo, "repo_path", "") or ""),
        }
    return out


def _file_size_bytes(path: Path, *, follow_symlinks: bool = False) -> int:
    try:
        st = path.stat() if follow_symlinks else path.lstat()
        return int(st.st_size)
    except OSError:
        return 0


def _dir_size_bytes(path: Path, *, follow_symlinks: bool = False) -> int:
    """Sum file sizes under path. Default uses lstat so hub snapshots/ symlinks are not
    double-counted alongside blobs/."""
    total = 0
    if not path.exists():
        return 0
    for root, _dirs, files in os.walk(path, followlinks=False):
        for name in files:
            total += _file_size_bytes(Path(root) / name, follow_symlinks=follow_symlinks)
    return total


def _repo_progress_bytes(repo_dir: Path) -> int:
    """Bytes fetched for a Hub repo.

    Count only under blobs/ (including .incomplete). Follow symlinks once — HF Xet
    stores blob payloads behind symlinks — but never walk snapshots/, or the same
    weights are counted twice (~2× total, e.g. 43 GB / 26 GB).
    """
    blobs = repo_dir / "blobs"
    if blobs.is_dir():
        return _dir_size_bytes(blobs, follow_symlinks=True)
    return _scoped_snapshot_bytes(repo_dir) or _dir_size_bytes(repo_dir, follow_symlinks=True)


def _scoped_snapshot_bytes(repo_dir: Path, filters: dict[str, Any] | None = None) -> int:
    """Sum resolved sizes of snapshot files that match Diffusers allow filters."""
    snaps = repo_dir / "snapshots"
    if not snaps.is_dir():
        return 0
    total = 0
    filt = filters or {}
    for snap in snaps.iterdir():
        if not snap.is_dir():
            continue
        for path in snap.rglob("*"):
            if not path.is_file() and not path.is_symlink():
                continue
            rel = str(path.relative_to(snap)).replace("\\", "/")
            if filt and not _sibling_allowed(rel, filt):
                continue
            # Follow symlink once — each logical weight counted once.
            total += _file_size_bytes(path, follow_symlinks=True)
    return total


def _emit_progress(payload: dict[str, Any]) -> None:
    sys.stderr.write(f"[MODEL_CACHE_PROGRESS] {json.dumps(payload, separators=(',', ':'))}\n")
    sys.stderr.flush()


def _diffusers_ready(repo_path: Path | None) -> bool:
    """Partial mono-repo blobs must not count as a usable Diffusers cache."""
    if repo_path is None or not repo_path.exists():
        return False
    # snapshot dirs: models--X/snapshots/<rev>/model_index.json
    for snap in repo_path.glob("snapshots/*/model_index.json"):
        if snap.is_file():
            return True
    return (repo_path / "model_index.json").is_file()


def list_models(model_ids: list[str]) -> dict[str, Any]:
    cached = _scan_cached_repos()
    cache_root = str(_hub_cache_path())
    models: list[dict[str, Any]] = []
    for raw_id in model_ids:
        catalog_id = raw_id.strip()
        if not catalog_id:
            continue
        hub_id = resolve_hub_model_id(catalog_id)
        hit = cached.get(hub_id)
        # Also accept exact catalog id if it differs and is cached under that name.
        if hit is None:
            hit = cached.get(catalog_id)
        repo_path = Path(str(hit["path"])) if hit and hit.get("path") else _hub_cache_path() / _repo_folder_name(hub_id)
        needs_diffusers = bool(_download_filters(hub_id))
        ready = bool(hit) and (not needs_diffusers or _diffusers_ready(repo_path))
        entry: dict[str, Any] = {
            "model_id": catalog_id,
            "hub_id": hub_id,
            "cached": ready,
            "size_bytes": int(hit["size_bytes"]) if hit and ready else _dir_size_bytes(repo_path),
            "files": int(hit["files"]) if hit and ready else 0,
            "revision": hit.get("revision") if hit and ready else None,
            "path": str(repo_path) if repo_path.exists() else None,
            "proprietary": catalog_id.lower().startswith("anthropic/") or "claude" in catalog_id.lower(),
        }
        models.append(entry)

    total_cached = sum(1 for m in models if m["cached"] and not m["proprietary"])
    return {
        "ok": True,
        "cache_root": cache_root,
        "cached_repo_count": len(cached),
        "catalog_cached_count": total_cached,
        "models": models,
    }


def _download_filters(hub_id: str) -> dict[str, Any]:
    """Limit snapshot_download to Diffusers runtime files (LTX mono-repo is ~280 GB otherwise)."""
    mid = hub_id.lower()
    if "ltx" in mid or "lightricks/ltx" in mid:
        return {
            "allow_patterns": [
                "model_index.json",
                "scheduler/*",
                "text_encoder/*",
                "tokenizer/*",
                "transformer/*",
                "vae/*",
            ],
            "ignore_patterns": [
                "ltx-video-*.safetensors",
                "ltxv-*.safetensors",
                "*.license.txt",
                "media/*",
            ],
        }
    if "wan" in mid and "diffusers" in mid:
        return {
            "allow_patterns": [
                "model_index.json",
                "scheduler/*",
                "text_encoder/*",
                "tokenizer/*",
                "transformer/*",
                "vae/*",
            ],
        }
    return {}


def _sibling_allowed(filename: str, filters: dict[str, Any]) -> bool:
    from fnmatch import fnmatch

    name = filename.lstrip("/")
    ignore = filters.get("ignore_patterns") or []
    allow = filters.get("allow_patterns") or []
    for pat in ignore:
        if fnmatch(name, pat) or fnmatch(name.split("/")[-1], pat):
            return False
    if not allow:
        return True
    return any(fnmatch(name, pat) for pat in allow)


def _estimate_repo_bytes(hub_id: str, filters: dict[str, Any] | None = None) -> int | None:
    try:
        from huggingface_hub import HfApi  # type: ignore[import-not-found]

        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        info = HfApi(token=token).model_info(hub_id, files_metadata=True)
        siblings = getattr(info, "siblings", None) or []
        filt = filters or {}
        sizes: list[int] = []
        for s in siblings:
            size = getattr(s, "size", None)
            rfilename = getattr(s, "rfilename", None) or getattr(s, "filename", None)
            if size is None or not rfilename:
                continue
            if filt and not _sibling_allowed(str(rfilename), filt):
                continue
            sizes.append(int(size))
        return sum(sizes) if sizes else None
    except Exception:
        return None


def ensure_model(model_id: str) -> dict[str, Any]:
    hub_id = resolve_hub_model_id(model_id)
    if model_id.lower().startswith("anthropic/") or "claude" in model_id.lower():
        return {
            "ok": False,
            "model_id": model_id,
            "hub_id": hub_id,
            "cached": False,
            "error": "Proprietary API model — no local Hugging Face checkpoint to download.",
        }

    existing = list_models([model_id])["models"][0]
    if existing["cached"]:
        _emit_progress(
            {
                "model_id": model_id,
                "hub_id": hub_id,
                "status": "ready",
                "percent": 100,
                "message": "Already present in local Hugging Face cache",
                "bytes_cached": existing["size_bytes"],
                "bytes_total": existing["size_bytes"],
            }
        )
        return {"ok": True, **existing, "download": False}

    try:
        from huggingface_hub import snapshot_download  # type: ignore[import-not-found]
    except Exception as exc:
        return {
            "ok": False,
            "model_id": model_id,
            "hub_id": hub_id,
            "cached": False,
            "error": f"huggingface_hub not installed: {exc}",
        }

    filters = _download_filters(hub_id)
    bytes_total = _estimate_repo_bytes(hub_id, filters)
    repo_dir = _hub_cache_path() / _repo_folder_name(hub_id)
    stop = threading.Event()

    def _poll() -> None:
        while not stop.wait(1.5):
            cached_bytes = _repo_progress_bytes(repo_dir)
            if bytes_total and bytes_total > 0:
                # Never report >95% until snapshot_download returns; clamp cached for display math.
                ratio = min(cached_bytes, bytes_total) / bytes_total
                pct = int(min(95, max(1, ratio * 100)))
            else:
                pct = 15 if cached_bytes == 0 else 55
            _emit_progress(
                {
                    "model_id": model_id,
                    "hub_id": hub_id,
                    "status": "downloading",
                    "percent": pct,
                    "message": f"Downloading Diffusers runtime files for {hub_id}",
                    "bytes_cached": min(cached_bytes, bytes_total) if bytes_total else cached_bytes,
                    "bytes_total": bytes_total,
                }
            )

    scope_note = " (Diffusers folders only; skipping mono-repo Comfy checkpoints)" if filters else ""
    start_cached = _repo_progress_bytes(repo_dir)
    _emit_progress(
        {
            "model_id": model_id,
            "hub_id": hub_id,
            "status": "downloading",
            "percent": 1,
            "message": f"Starting download of {hub_id}{scope_note}",
            "bytes_cached": min(start_cached, bytes_total) if bytes_total else start_cached,
            "bytes_total": bytes_total,
        }
    )

    cancelled = {"flag": False}

    def _on_signal(_signum: int, _frame: object) -> None:
        cancelled["flag"] = True
        raise KeyboardInterrupt("download cancelled")

    prev_term = signal.getsignal(signal.SIGTERM)
    prev_int = signal.getsignal(signal.SIGINT)
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    poller = threading.Thread(target=_poll, name="hf-cache-poll", daemon=True)
    poller.start()
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    t0 = time.perf_counter()
    try:
        path = snapshot_download(repo_id=hub_id, token=token, **filters)
    except (KeyboardInterrupt, SystemExit) as exc:
        stop.set()
        poller.join(timeout=2)
        purged = purge_incomplete(model_id)
        msg = "Download cancelled"
        _emit_progress(
            {
                "model_id": model_id,
                "hub_id": hub_id,
                "status": "cancelled",
                "percent": 0,
                "message": msg,
                "bytes_cached": _repo_progress_bytes(repo_dir),
                "bytes_total": bytes_total,
            }
        )
        return {
            "ok": False,
            "model_id": model_id,
            "hub_id": hub_id,
            "cached": False,
            "cancelled": True,
            "purged_incomplete_bytes": purged.get("purged_bytes", 0),
            "error": msg if cancelled["flag"] else str(exc),
        }
    except Exception as exc:
        stop.set()
        poller.join(timeout=2)
        _emit_progress(
            {
                "model_id": model_id,
                "hub_id": hub_id,
                "status": "error",
                "percent": 0,
                "message": str(exc),
                "bytes_cached": _repo_progress_bytes(repo_dir),
                "bytes_total": bytes_total,
            }
        )
        return {
            "ok": False,
            "model_id": model_id,
            "hub_id": hub_id,
            "cached": False,
            "error": str(exc),
        }
    finally:
        signal.signal(signal.SIGTERM, prev_term)
        signal.signal(signal.SIGINT, prev_int)
        stop.set()
        poller.join(timeout=2)

    scoped = _scoped_snapshot_bytes(repo_dir, filters)
    size_bytes = scoped or _repo_progress_bytes(repo_dir) or _dir_size_bytes(Path(path), follow_symlinks=True)
    final_total = bytes_total or size_bytes
    _emit_progress(
        {
            "model_id": model_id,
            "hub_id": hub_id,
            "status": "ready",
            "percent": 100,
            "message": f"Download complete ({size_bytes} bytes, {time.perf_counter() - t0:.1f}s)",
            "bytes_cached": size_bytes,
            "bytes_total": final_total,
        }
    )
    return {
        "ok": True,
        "model_id": model_id,
        "hub_id": hub_id,
        "cached": True,
        "size_bytes": size_bytes,
        "path": str(path),
        "download": True,
    }


def purge_incomplete(model_id: str) -> dict[str, Any]:
    """Delete *.incomplete Hub blobs for a model (cancel / abort cleanup)."""
    hub_id = resolve_hub_model_id(model_id)
    repo_dir = _hub_cache_path() / _repo_folder_name(hub_id)
    purged_files = 0
    purged_bytes = 0
    if not repo_dir.exists():
        return {
            "ok": True,
            "model_id": model_id,
            "hub_id": hub_id,
            "purged_files": 0,
            "purged_bytes": 0,
            "path": str(repo_dir),
        }
    for root, _dirs, files in os.walk(repo_dir):
        for name in files:
            if not name.endswith(".incomplete"):
                continue
            path = Path(root) / name
            try:
                size = path.stat().st_size
                path.unlink()
                purged_files += 1
                purged_bytes += size
            except OSError:
                continue
    return {
        "ok": True,
        "model_id": model_id,
        "hub_id": hub_id,
        "purged_files": purged_files,
        "purged_bytes": purged_bytes,
        "path": str(repo_dir),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="apps.worker.model_cache")
    sub = parser.add_subparsers(dest="cmd", required=True)

    list_p = sub.add_parser("list", help="List cache status for catalog model ids")
    list_p.add_argument("--models", required=True, help="Comma-separated model ids")

    ensure_p = sub.add_parser("ensure", help="Download model weights into local HF cache if missing")
    ensure_p.add_argument("--model", required=True, help="Catalog or Hub model id")

    purge_p = sub.add_parser(
        "purge-incomplete",
        help="Delete incomplete Hub blob downloads for a model (cancel cleanup)",
    )
    purge_p.add_argument("--model", required=True, help="Catalog or Hub model id")

    args = parser.parse_args(argv)
    if args.cmd == "list":
        ids = [m.strip() for m in str(args.models).split(",") if m.strip()]
        print(json.dumps(list_models(ids), separators=(",", ":")))
        return 0
    if args.cmd == "ensure":
        result = ensure_model(str(args.model))
        print(json.dumps(result, separators=(",", ":")))
        if result.get("cancelled"):
            return 130
        return 0 if result.get("ok") else 2
    if args.cmd == "purge-incomplete":
        result = purge_incomplete(str(args.model))
        print(json.dumps(result, separators=(",", ":")))
        return 0 if result.get("ok") else 2
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
