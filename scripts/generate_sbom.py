#!/usr/bin/env python3
"""Software Bill of Materials (SBOM) Generator.

Generates CycloneDX-compliant SBOMs for both Python and Node.js dependencies
across the multi-tenant AI inference platform repository.

Usage:
    python3 scripts/generate_sbom.py [--output docs/security/sbom.json] [--format cyclonedx]
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def extract_node_dependencies(repo_root: Path) -> list[dict]:
    """Extract Node.js packages from package.json and workspace manifests."""
    components = []
    seen = set()

    package_files = [
        repo_root / "package.json",
        repo_root / "apps" / "api" / "package.json",
    ]

    for pf in package_files:
        if not pf.is_file():
            continue
        try:
            with open(pf, "r", encoding="utf-8") as f:
                data = json.load(f)
            deps = {
                **data.get("dependencies", {}),
                **data.get("devDependencies", {}),
            }
            for name, version in deps.items():
                if name.startswith("@platform/") or name in seen:
                    continue
                clean_ver = re.sub(r"^[\^~>=<]", "", version).strip()
                seen.add(name)
                components.append(
                    {
                        "type": "library",
                        "name": name,
                        "version": clean_ver or "latest",
                        "purl": f"pkg:npm/{name}@{clean_ver or 'latest'}",
                        "scope": "required",
                    }
                )
        except Exception as e:
            print(f"Warning: Failed to parse {pf}: {e}", file=sys.stderr)

    return sorted(components, key=lambda c: c["name"])


def extract_python_dependencies(repo_root: Path) -> list[dict]:
    """Extract Python dependencies from pyproject.toml."""
    components = []
    seen = set()

    pyproject_files = [
        repo_root / "pyproject.toml",
        repo_root / "apps" / "worker" / "pyproject.toml",
    ]

    dep_pattern = re.compile(r'^\s*["\']([a-zA-Z0-9_\-\.]+)(?:[>=<~^!]+([^"\']+))?["\']')

    for ppf in pyproject_files:
        if not ppf.is_file():
            continue
        try:
            with open(ppf, "r", encoding="utf-8") as f:
                lines = f.readlines()
            in_deps = False
            for line in lines:
                stripped = line.strip()
                if "dependencies = [" in stripped:
                    in_deps = True
                    continue
                if in_deps:
                    if stripped.startswith("]"):
                        in_deps = False
                        continue
                    m = dep_pattern.match(stripped)
                    if m:
                        pkg = m.group(1).lower()
                        ver = m.group(2) or "latest"
                        if pkg not in seen:
                            seen.add(pkg)
                            components.append(
                                {
                                    "type": "library",
                                    "name": pkg,
                                    "version": ver.strip(),
                                    "purl": f"pkg:pypi/{pkg}@{ver.strip()}",
                                    "scope": "required",
                                }
                            )
        except Exception as e:
            print(f"Warning: Failed to parse {ppf}: {e}", file=sys.stderr)

    return sorted(components, key=lambda c: c["name"])


def build_cyclonedx_sbom(repo_root: Path) -> dict:
    """Build complete CycloneDX 1.5 JSON SBOM."""
    node_comps = extract_node_dependencies(repo_root)
    py_comps = extract_python_dependencies(repo_root)
    all_comps = node_comps + py_comps

    now = datetime.now(timezone.utc).isoformat()
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "serialNumber": f"urn:uuid:platform-sbom-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        "version": 1,
        "metadata": {
            "timestamp": now,
            "tools": [
                {
                    "vendor": "Multi-Tenant AI Inference Platform",
                    "name": "Platform SBOM Generator",
                    "version": "1.0.0",
                }
            ],
            "component": {
                "type": "application",
                "name": "multi-tenant-ai-inference-platform",
                "version": "0.1.0",
                "description": "Production reference platform for multi-tenant AI inference workloads",
            },
        },
        "components": all_comps,
    }


def main():
    parser = argparse.ArgumentParser(description="Generate platform CycloneDX SBOM")
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default="docs/security/sbom.json",
        help="Target output file path",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    sbom = build_cyclonedx_sbom(repo_root)

    out_path = repo_root / args.output
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(sbom, f, indent=2)
        f.write("\n")

    total_comps = len(sbom["components"])
    print(f"SBOM successfully generated: {args.output}")
    print(f"Total cataloged components: {total_comps}")
    print(f"  - Node.js libraries: {len([c for c in sbom['components'] if c['purl'].startswith('pkg:npm')])}")
    print(f"  - Python libraries:  {len([c for c in sbom['components'] if c['purl'].startswith('pkg:pypi')])}")


if __name__ == "__main__":
    main()
