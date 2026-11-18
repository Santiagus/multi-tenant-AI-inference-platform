#!/usr/bin/env python3
"""Model Context Protocol (MCP) configuration and synchronization script.

Enables any developer or agent to replicate the full multi-provider MCP setup
(RunPod, Runware, Nebius, Baseten, Weights & Biases, fal.ai) across local
environments:
  - Workspace MCP configuration (.mcp.json)
  - Sanitized reference template (.mcp.example.json)
  - Antigravity / Gemini CLI user configuration (~/.gemini/config/mcp_config.json)
  - Connectivity probes and health verification

Usage:
  python3 scripts/setup_mcp.py --sync
  python3 scripts/setup_mcp.py --check
  python3 scripts/setup_mcp.py --generate-example
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent


def load_env(env_path: Path) -> dict[str, str]:
    """Parse key-value pairs from a .env file without modifying os.environ."""
    env_vars: dict[str, str] = {}
    if not env_path.is_file():
        return env_vars

    with open(env_path, encoding="utf-8") as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            k, v = stripped.split("=", 1)
            env_vars[k.strip()] = v.strip().strip("'\"")
    return env_vars


def get_var(key: str, env_file_vars: dict[str, str], default: str = "") -> str:
    """Retrieve variable from system environment or .env file."""
    return os.environ.get(key) or env_file_vars.get(key, default)


def build_mcp_config(env_vars: dict[str, str], sanitized: bool = False) -> dict[str, Any]:
    """Construct complete MCP server configuration."""
    runpod_key = "rpa_your_runpod_api_key_here" if sanitized else get_var("RUNPOD_API_KEY", env_vars)
    runware_key = "your_runware_api_key_here" if sanitized else get_var("RUNWARE_API_KEY", env_vars)
    baseten_key = "your_baseten_api_key_here" if sanitized else get_var("BASETEN_API_KEY", env_vars)
    wandb_key = "wandb_v1_your_api_key_here" if sanitized else get_var("WANDB_API_KEY", env_vars)
    fal_key = "fal_sk_your_key_here" if sanitized else get_var("FAL_KEY", env_vars)

    npx_bin = "npx"
    uvx_bin = "uvx"

    servers: dict[str, Any] = {}

    # 1. RunPod MCP (SSE Gateway)
    servers["runpod"] = {
        "serverUrl": get_var("RUNPOD_MCP_URL", env_vars, "https://mcp.runpod.io/"),
        "headers": {"Authorization": f"Bearer {runpod_key}"},
        "disabled": not bool(runpod_key) if not sanitized else False,
    }

    # 2. Runware MCP (Local Stdio via npx)
    servers["runware"] = {
        "command": npx_bin,
        "args": ["-y", "@runware/mcp"],
        "env": {
            "RUNWARE_API_KEY": runware_key,
        },
    }

    # 3. Nebius MCP (Local Stdio via uvx)
    servers["nebius"] = {
        "command": uvx_bin,
        "args": [
            "--with",
            "pydantic<2.10",
            "--refresh-package",
            "nebius-mcp-server",
            "nebius-mcp-server@git+https://github.com/nebius/mcp-server@main",
        ],
        "env": {
            "SAFE_MODE": "true",
        },
    }

    # 4. Baseten MCP (SSE Gateway)
    servers["baseten"] = {
        "serverUrl": get_var("BASETEN_MCP_URL", env_vars, "https://api.baseten.co/mcp"),
        "headers": {"Authorization": f"Bearer {baseten_key}"},
        "disabled": not bool(baseten_key) if not sanitized else False,
    }

    # 5. Weights & Biases (Weave Tracing MCP)
    servers["wandb"] = {
        "serverUrl": get_var("WANDB_MCP_URL", env_vars, "https://mcp.withwandb.com/mcp"),
        "headers": {"Authorization": f"Bearer {wandb_key}"},
        "disabled": not bool(wandb_key) if not sanitized else False,
    }

    # 6. fal.ai (Serverless Media & Diffusion MCP)
    servers["fal"] = {
        "serverUrl": get_var("FAL_MCP_URL", env_vars, "https://mcp.fal.ai/mcp-relay"),
        "headers": {"Authorization": f"Key {fal_key}"},
        "disabled": not bool(fal_key) if not sanitized else False,
    }

    return {"mcpServers": servers}


def check_mcp_servers(config: dict[str, Any]) -> int:
    """Verify reachability and prerequisites for all configured MCP servers."""
    print("=" * 70)
    print("  MCP Server Health & Configuration Verification")
    print("=" * 70)

    servers = config.get("mcpServers", {})
    all_ok = True

    for name, s_cfg in servers.items():
        print(f"\n[*] Server: {name}")
        if "serverUrl" in s_cfg:
            url = s_cfg["serverUrl"]
            headers = s_cfg.get("headers", {})
            auth_set = any("Authorization" in k for k in headers)
            print(f"    - Type: Remote SSE / HTTP ({url})")
            print(f"    - Auth Header Configured: {auth_set}")

            # Probe endpoint HEAD / GET
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "MCP-Diagnostic/1.0", **headers})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    print(f"    - Connectivity: REACHABLE (HTTP {resp.status})")
            except urllib.error.HTTPError as err:
                # 400/401/404/405 typically indicate active server endpoint handling requests
                print(f"    - Connectivity: REACHABLE (HTTP {err.code})")
            except Exception as exc:
                print(f"    - Connectivity WARN: {exc}")
        elif "command" in s_cfg:
            cmd = s_cfg["command"]
            found = shutil.which(cmd) is not None or Path(cmd).is_file()
            print(f"    - Type: Stdio Process (`{cmd}`)")
            print(f"    - Executable Found: {found}")
            if not found:
                print(f"    - WARN: Command '{cmd}' not found on PATH. Install node/npm or uv.")
                all_ok = False
            args = s_cfg.get("args", [])
            print(f"    - Package Args: {' '.join(args)}")

    print("\n" + "=" * 70)
    if all_ok:
        print("  All MCP servers validated and configured.")
    else:
        print("  Some MCP servers require missing prerequisites (see warnings above).")
    print("=" * 70)
    return 0 if all_ok else 1


def sync_mcp_config(env_vars: dict[str, str]) -> None:
    """Synchronize MCP configuration across workspace and user locations."""
    # 1. Generate sanitized example template (.mcp.example.json)
    sanitized_cfg = build_mcp_config(env_vars, sanitized=True)
    example_path = REPO_ROOT / ".mcp.example.json"
    example_path.write_text(json.dumps(sanitized_cfg, indent=2) + "\n", encoding="utf-8")
    print(f"[OK] Generated sanitized MCP reference: {example_path.name}")

    # 2. Generate workspace-level .mcp.json (using local environment)
    active_cfg = build_mcp_config(env_vars, sanitized=False)
    workspace_mcp_path = REPO_ROOT / ".mcp.json"
    workspace_mcp_path.write_text(json.dumps(active_cfg, indent=2) + "\n", encoding="utf-8")
    print(f"[OK] Synchronized workspace MCP configuration: {workspace_mcp_path.name}")

    # 3. Synchronize to Antigravity global user configuration if directory exists
    user_gemini_cfg_dir = Path.home() / ".gemini" / "config"
    if user_gemini_cfg_dir.is_dir():
        user_mcp_path = user_gemini_cfg_dir / "mcp_config.json"
        user_mcp_path.write_text(json.dumps(active_cfg, indent=2) + "\n", encoding="utf-8")
        print(f"[OK] Synchronized user MCP configuration: {user_mcp_path}")
    else:
        print(f"[INFO] User directory {user_gemini_cfg_dir} not present; skipping global sync.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Multi-Provider MCP Setup & Synchronization")
    parser.add_argument("--sync", action="store_true", help="Synchronize MCP configurations")
    parser.add_argument("--check", action="store_true", help="Check health and connectivity of MCP servers")
    parser.add_argument("--generate-example", action="store_true", help="Generate .mcp.example.json")
    args = parser.parse_args()

    env_vars = load_env(REPO_ROOT / ".env")

    if args.generate_example:
        sanitized_cfg = build_mcp_config(env_vars, sanitized=True)
        example_path = REPO_ROOT / ".mcp.example.json"
        example_path.write_text(json.dumps(sanitized_cfg, indent=2) + "\n", encoding="utf-8")
        print(f"Generated {example_path}")
        return

    if args.check:
        config = build_mcp_config(env_vars, sanitized=False)
        sys.exit(check_mcp_servers(config))

    # Default action: sync and check
    sync_mcp_config(env_vars)
    config = build_mcp_config(env_vars, sanitized=False)
    sys.exit(check_mcp_servers(config))


if __name__ == "__main__":
    main()
