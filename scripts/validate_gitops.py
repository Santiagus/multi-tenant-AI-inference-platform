#!/usr/bin/env python3
"""GitOps, CI/CD, and Argo CD declarative manifest validator.

Validates:
1. Multi-stage GitHub Actions workflows (validation, test, security/SBOM, terraform, image build, benchmark, deploy).
2. GitHub OIDC federated AWS IAM configuration.
3. Declarative Argo CD manifests (AppProject, Application, App-of-Apps) and environment overlays (staging vs production).
4. Strict enforcement of M10 Acceptance Criteria: GitHub Actions never bypasses GitOps
   by directly applying production Kubernetes state via imperative kubectl/helm commands.
5. Strict cost guardrail enforcement: Benchmarks are manual-only (no automated cron schedule),
   and CI/CD environments enforce mock inference mode (zero real inference costs).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

PROHIBITED_IMPERATIVE_COMMANDS = [
    r"\bkubectl\s+(?:apply|create|replace|patch|delete|edit|run|rollout)\b",
    r"\bhelm\s+(?:install|upgrade|rollback|uninstall)\b",
]

REQUIRED_CI_STAGES = [
    "fast-validation",
    "integration-tests",
    "security-and-sbom",
    "infrastructure-validation",
    "image-build",
]


def load_yaml(path: Path) -> dict[str, Any] | list[Any]:
    """Parse a YAML file safely."""
    try:
        content = path.read_text(encoding="utf-8")
        parsed = yaml.safe_load(content)
        return parsed if parsed is not None else {}
    except Exception as exc:
        raise ValueError(f"Failed to parse YAML file {path}: {exc}") from exc


def validate_no_imperative_k8s_bypass(repo_root: Path) -> list[str]:
    """Verify that CI/CD workflows never directly mutate production Kubernetes clusters."""
    violations: list[str] = []
    workflows_dir = repo_root / ".github" / "workflows"
    if not workflows_dir.is_dir():
        violations.append("Missing .github/workflows directory.")
        return violations

    for wf_path in workflows_dir.glob("*.yml"):
        content = wf_path.read_text(encoding="utf-8")
        for line_no, line in enumerate(content.splitlines(), start=1):
            # Ignore comments and echo statements
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith("echo "):
                continue

            for pattern in PROHIBITED_IMPERATIVE_COMMANDS:
                if re.search(pattern, stripped):
                    violations.append(
                        f"{wf_path.name}:{line_no}: Imperative Kubernetes mutation detected ('{stripped}'). "
                        "GitHub Actions must never bypass GitOps by directly applying Kubernetes state."
                    )
    return violations


def validate_ci_workflow(repo_root: Path) -> list[str]:
    """Validate that .github/workflows/ci.yml defines all required CI stages, OIDC, and mock inference cost guardrails."""
    issues: list[str] = []
    ci_path = repo_root / ".github" / "workflows" / "ci.yml"
    if not ci_path.is_file():
        issues.append(f"Missing primary CI workflow at {ci_path}")
        return issues

    wf = load_yaml(ci_path)
    if not isinstance(wf, dict):
        issues.append("ci.yml must parse into a YAML mapping.")
        return issues

    # Permissions check
    permissions = wf.get("permissions", {})
    if not isinstance(permissions, dict):
        issues.append("ci.yml must declare top-level permissions object.")
    else:
        if permissions.get("id-token") != "write":
            issues.append("ci.yml missing 'id-token: write' permission for GitHub OIDC authentication.")
        if permissions.get("contents") != "read":
            issues.append("ci.yml missing 'contents: read' permission.")

    # Cost guardrail: verify mock inference environment variables are configured
    env_vars = wf.get("env", {})
    if isinstance(env_vars, dict):
        if env_vars.get("INFERENCE_MOCK_MODE") != "true" and env_vars.get("BEDROCK_MOCK") != "1":
            issues.append("ci.yml must set INFERENCE_MOCK_MODE/BEDROCK_MOCK to prevent real inference costs in CI.")

    # Jobs check
    jobs = wf.get("jobs", {})
    if not isinstance(jobs, dict):
        issues.append("ci.yml must define 'jobs' mapping.")
        return issues

    for stage in REQUIRED_CI_STAGES:
        if stage not in jobs:
            issues.append(f"ci.yml missing required CI stage: '{stage}'")

    # Image build job checks
    image_job = jobs.get("image-build", {})
    if isinstance(image_job, dict):
        steps = image_job.get("steps", [])
        has_oidc = any("aws-actions/configure-aws-credentials" in str(s.get("uses", "")) for s in steps)
        if not has_oidc:
            issues.append("image-build job missing 'aws-actions/configure-aws-credentials' step for AWS OIDC.")

    return issues


def validate_benchmark_workflow(repo_root: Path) -> list[str]:
    """Validate that .github/workflows/benchmark.yml exists with manual dispatch only (no automatic cron)."""
    issues: list[str] = []
    bm_path = repo_root / ".github" / "workflows" / "benchmark.yml"
    if not bm_path.is_file():
        issues.append(f"Missing benchmark workflow at {bm_path}")
        return issues

    wf = load_yaml(bm_path)
    if not isinstance(wf, dict):
        issues.append("benchmark.yml must parse into a YAML mapping.")
        return issues

    on_clause: dict[str, Any] = {}
    raw_on = wf.get("on")
    if isinstance(raw_on, dict):
        on_clause = raw_on
    else:
        for k, v in wf.items():
            if str(k).lower() in ("true", "on") and isinstance(v, dict):
                on_clause = v
                break

    if "workflow_dispatch" not in on_clause:
        issues.append("benchmark.yml missing 'workflow_dispatch' trigger.")

    # Cost guardrail: Automated cron schedule is prohibited to prevent uncontrolled compute costs
    if "schedule" in on_clause:
        issues.append(
            "benchmark.yml must NOT declare automated 'schedule' cron triggers. "
            "Benchmarks must be strictly on-demand (workflow_dispatch) to avoid unwanted costs."
        )

    return issues


def validate_deploy_workflow(repo_root: Path) -> list[str]:
    """Validate that .github/workflows/deploy.yml supports staging and production with approval gates."""
    issues: list[str] = []
    deploy_path = repo_root / ".github" / "workflows" / "deploy.yml"
    if not deploy_path.is_file():
        issues.append(f"Missing deploy workflow at {deploy_path}")
        return issues

    wf = load_yaml(deploy_path)
    if not isinstance(wf, dict):
        issues.append("deploy.yml must parse into a YAML mapping.")
        return issues

    jobs = wf.get("jobs", {})
    if not isinstance(jobs, dict):
        issues.append("deploy.yml must define 'jobs' mapping.")
        return issues

    if "promote-staging" not in jobs:
        issues.append("deploy.yml missing 'promote-staging' job.")
    if "promote-production" not in jobs:
        issues.append("deploy.yml missing 'promote-production' job.")

    prod_job = jobs.get("promote-production", {})
    if isinstance(prod_job, dict):
        env = prod_job.get("environment")
        env_name = env.get("name") if isinstance(env, dict) else env
        if env_name != "production":
            issues.append("promote-production job must be bound to GitHub 'production' environment protection gate.")
        needs = prod_job.get("needs")
        if needs != "promote-staging" and not (isinstance(needs, list) and "promote-staging" in needs):
            issues.append("promote-production job must depend on 'promote-staging'.")

    return issues


def validate_argocd_manifests(repo_root: Path) -> list[str]:
    """Validate declarative Argo CD manifests."""
    issues: list[str] = []
    argocd_dir = repo_root / "deploy" / "argocd"
    if not argocd_dir.is_dir():
        issues.append(f"Missing Argo CD directory at {argocd_dir}")
        return issues

    # 1. Project
    proj_path = argocd_dir / "argocd-project.yaml"
    if not proj_path.is_file():
        issues.append(f"Missing Argo CD project at {proj_path}")
    else:
        proj = load_yaml(proj_path)
        if isinstance(proj, dict):
            if proj.get("kind") != "AppProject":
                issues.append(f"{proj_path.name}: kind must be AppProject")
            destinations = proj.get("spec", {}).get("destinations", [])
            dest_namespaces = {d.get("namespace") for d in destinations if isinstance(d, dict)}
            for ns in ["inference-platform", "inference-workers"]:
                if ns not in dest_namespaces:
                    issues.append(f"{proj_path.name}: destination namespace '{ns}' missing from whitelist.")

    # 2. Staging Application
    staging_path = argocd_dir / "application-staging.yaml"
    if not staging_path.is_file():
        issues.append(f"Missing Argo CD staging application at {staging_path}")
    else:
        stg = load_yaml(staging_path)
        if isinstance(stg, dict):
            if stg.get("kind") != "Application":
                issues.append(f"{staging_path.name}: kind must be Application")
            sync_policy = stg.get("spec", {}).get("syncPolicy", {})
            automated = sync_policy.get("automated", {})
            if not automated.get("prune") or not automated.get("selfHeal"):
                issues.append(f"{staging_path.name}: staging syncPolicy must enable prune and selfHeal.")

    # 3. Production Application
    prod_path = argocd_dir / "application-production.yaml"
    if not prod_path.is_file():
        issues.append(f"Missing Argo CD production application at {prod_path}")
    else:
        prd = load_yaml(prod_path)
        if isinstance(prd, dict):
            if prd.get("kind") != "Application":
                issues.append(f"{prod_path.name}: kind must be Application")
            labels = prd.get("metadata", {}).get("labels", {})
            if labels.get("approval-required") != "true":
                issues.append(f"{prod_path.name}: production must declare 'approval-required: \"true\"' label.")
            sync_policy = prd.get("spec", {}).get("syncPolicy", {})
            if "automated" in sync_policy:
                issues.append(f"{prod_path.name}: production must not enable unrestricted automated sync.")

    # 4. Root App-of-Apps
    root_path = argocd_dir / "root-app-of-apps.yaml"
    if not root_path.is_file():
        issues.append(f"Missing Argo CD root app-of-apps at {root_path}")
    else:
        root_app = load_yaml(root_path)
        if isinstance(root_app, dict) and root_app.get("kind") != "Application":
            issues.append(f"{root_path.name}: kind must be Application")

    return issues


def validate_environment_overlays(repo_root: Path) -> list[str]:
    """Validate environment values overlays for staging and production."""
    issues: list[str] = []
    envs_dir = repo_root / "deploy" / "environments"
    if not envs_dir.is_dir():
        issues.append(f"Missing environment overlays directory at {envs_dir}")
        return issues

    for env_name in ["staging", "production"]:
        val_path = envs_dir / env_name / "values.yaml"
        if not val_path.is_file():
            issues.append(f"Missing values overlay for environment '{env_name}' at {val_path}")
            continue

        val = load_yaml(val_path)
        if not isinstance(val, dict):
            issues.append(f"{val_path}: values must be a dictionary.")
            continue

        declared_env = val.get("global", {}).get("environment")
        if declared_env != env_name:
            issues.append(f"{val_path}: global.environment is '{declared_env}', expected '{env_name}'")

        api_tag = val.get("api", {}).get("image", {}).get("tag")
        if not api_tag:
            issues.append(f"{val_path}: api.image.tag must be specified.")

        worker_tag = val.get("worker", {}).get("image", {}).get("tag")
        if not worker_tag:
            issues.append(f"{val_path}: worker.image.tag must be specified.")

    return issues


def update_environment_tag(repo_root: Path, environment: str, tag: str) -> None:
    """Update container image tags in deploy/environments/{environment}/values.yaml."""
    val_path = repo_root / "deploy" / "environments" / environment / "values.yaml"
    if not val_path.is_file():
        raise FileNotFoundError(f"Environment values file not found: {val_path}")

    content = val_path.read_text(encoding="utf-8")
    # Replace api and worker image tags
    new_content = re.sub(
        r'(\s+tag:\s*)"?[^"\n]+"?',
        rf'\1"{tag}"',
        content,
    )
    val_path.write_text(new_content, encoding="utf-8")
    print(f"Updated {environment} image tags to '{tag}' in {val_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="GitOps and CI/CD manifest validator.")
    parser.add_argument("--verify-no-bypass", action="store_true", help="Enforce zero imperative Kubernetes mutations")
    parser.add_argument("--update-env", choices=["staging", "production"], help="Update environment image tags")
    parser.add_argument("--tag", help="New image tag when using --update-env")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent

    if args.update_env:
        if not args.tag:
            print("ERROR: --tag is required when --update-env is specified.", file=sys.stderr)
            sys.exit(1)
        update_environment_tag(repo_root, args.update_env, args.tag)
        sys.exit(0)

    print("==> Validating GitHub Actions workflows...")
    issues: list[str] = []
    issues.extend(validate_ci_workflow(repo_root))
    issues.extend(validate_benchmark_workflow(repo_root))
    issues.extend(validate_deploy_workflow(repo_root))

    print("==> Enforcing GitOps non-bypass invariants (Acceptance Criteria)...")
    bypass_issues = validate_no_imperative_k8s_bypass(repo_root)
    issues.extend(bypass_issues)

    print("==> Validating Argo CD manifests and App-of-Apps...")
    issues.extend(validate_argocd_manifests(repo_root))

    print("==> Validating environment overlays (staging vs production)...")
    issues.extend(validate_environment_overlays(repo_root))

    if issues:
        print(f"\nGitOps Validation FAILED ({len(issues)} issues found):", file=sys.stderr)
        for issue in issues:
            print(f"  - {issue}", file=sys.stderr)
        sys.exit(1)

    print("\nGitOps Validation PASSED: All CI stages, Argo CD applications, and non-bypass invariants verified.")
    sys.exit(0)


if __name__ == "__main__":
    main()
