#!/usr/bin/env python3
"""Unit tests for GitOps, CI/CD pipeline stages, Argo CD applications, and non-bypass invariants (M10)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.validate_gitops import (
    load_yaml,
    validate_argocd_manifests,
    validate_benchmark_workflow,
    validate_ci_workflow,
    validate_deploy_workflow,
    validate_environment_overlays,
    validate_no_imperative_k8s_bypass,
)


class TestGitOpsCiCd(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parent.parent.parent

    def test_ci_workflow_stages_and_oidc(self) -> None:
        """ci.yml must define all 5 stages, OIDC permissions, and mock inference guardrails."""
        issues = validate_ci_workflow(self.repo_root)
        self.assertEqual(issues, [], f"ci.yml validation failed: {issues}")

        wf = load_yaml(self.repo_root / ".github" / "workflows" / "ci.yml")
        self.assertIsInstance(wf, dict)
        assert isinstance(wf, dict)
        permissions = wf.get("permissions", {})
        assert isinstance(permissions, dict)
        self.assertEqual(permissions.get("id-token"), "write")
        self.assertEqual(permissions.get("contents"), "read")

        env_vars = wf.get("env", {})
        assert isinstance(env_vars, dict)
        self.assertEqual(env_vars.get("INFERENCE_MOCK_MODE"), "true")

    def test_benchmark_workflow_triggers(self) -> None:
        """benchmark.yml must be manual-only (workflow_dispatch) with NO automated schedule to avoid unwanted compute costs."""
        issues = validate_benchmark_workflow(self.repo_root)
        self.assertEqual(issues, [], f"benchmark.yml validation failed: {issues}")

    def test_benchmark_validator_catches_unwanted_schedule(self) -> None:
        """Validator must fail if someone re-introduces automated schedule cron in benchmark.yml."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            wf_dir = tmp_root / ".github" / "workflows"
            wf_dir.mkdir(parents=True)

            bad_bm = wf_dir / "benchmark.yml"
            bad_bm.write_text(
                'name: Benchmark\n"on":\n  workflow_dispatch:\n  schedule:\n    - cron: "0 0 * * 0"\n',
                encoding="utf-8",
            )
            issues = validate_benchmark_workflow(tmp_root)
            self.assertTrue(any("must NOT declare automated 'schedule'" in issue for issue in issues))

    def test_deploy_workflow_promotion_and_approval(self) -> None:
        """deploy.yml must define promote-staging and promote-production with approval protection."""
        issues = validate_deploy_workflow(self.repo_root)
        self.assertEqual(issues, [], f"deploy.yml validation failed: {issues}")

    def test_acceptance_criteria_no_imperative_k8s_bypass(self) -> None:
        """GitHub Actions must never bypass GitOps by directly executing kubectl apply or helm upgrade."""
        issues = validate_no_imperative_k8s_bypass(self.repo_root)
        self.assertEqual(issues, [], f"Direct Kubernetes bypass detected in CI/CD workflows: {issues}")

    def test_bypass_detector_catches_imperative_mutations(self) -> None:
        """Validator must fail closed when an imperative kubectl apply or helm upgrade is attempted."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            wf_dir = tmp_root / ".github" / "workflows"
            wf_dir.mkdir(parents=True)

            # Test kubectl apply violation
            bad_wf = wf_dir / "bad-deploy.yml"
            bad_wf.write_text(
                "name: Bad Deploy\n"
                "jobs:\n"
                "  deploy:\n"
                "    runs-on: ubuntu-latest\n"
                "    steps:\n"
                "      - run: kubectl apply -f deploy/production.yaml\n",
                encoding="utf-8",
            )
            violations = validate_no_imperative_k8s_bypass(tmp_root)
            self.assertTrue(any("kubectl apply" in v for v in violations))

            # Test helm upgrade violation
            bad_wf.write_text(
                "name: Bad Helm Deploy\n"
                "jobs:\n"
                "  deploy:\n"
                "    runs-on: ubuntu-latest\n"
                "    steps:\n"
                "      - run: helm upgrade --install platform deploy/helm/inference-platform\n",
                encoding="utf-8",
            )
            violations = validate_no_imperative_k8s_bypass(tmp_root)
            self.assertTrue(any("helm upgrade" in v for v in violations))

    def test_argocd_manifests(self) -> None:
        """Argo CD manifests must declare valid AppProject, staging auto-sync, and production manual-sync with approval label."""
        issues = validate_argocd_manifests(self.repo_root)
        self.assertEqual(issues, [], f"Argo CD manifest validation failed: {issues}")

        # Check AppProject
        project = load_yaml(self.repo_root / "deploy" / "argocd" / "argocd-project.yaml")
        assert isinstance(project, dict)
        self.assertEqual(project.get("kind"), "AppProject")
        spec_proj = project.get("spec", {})
        assert isinstance(spec_proj, dict)
        destinations = spec_proj.get("destinations", [])
        assert isinstance(destinations, list)
        namespaces = {d.get("namespace") for d in destinations if isinstance(d, dict)}
        self.assertIn("inference-platform", namespaces)
        self.assertIn("inference-workers", namespaces)

        # Check Staging Application
        staging = load_yaml(self.repo_root / "deploy" / "argocd" / "application-staging.yaml")
        assert isinstance(staging, dict)
        self.assertEqual(staging.get("kind"), "Application")
        spec_stg = staging.get("spec", {})
        assert isinstance(spec_stg, dict)
        sync_policy = spec_stg.get("syncPolicy", {})
        assert isinstance(sync_policy, dict)
        auto_sync = sync_policy.get("automated", {})
        assert isinstance(auto_sync, dict)
        self.assertTrue(auto_sync.get("prune"))
        self.assertTrue(auto_sync.get("selfHeal"))

        # Check Production Application
        production = load_yaml(self.repo_root / "deploy" / "argocd" / "application-production.yaml")
        assert isinstance(production, dict)
        self.assertEqual(production.get("kind"), "Application")
        meta_prod = production.get("metadata", {})
        assert isinstance(meta_prod, dict)
        labels = meta_prod.get("labels", {})
        assert isinstance(labels, dict)
        self.assertEqual(labels.get("approval-required"), "true")
        spec_prod = production.get("spec", {})
        assert isinstance(spec_prod, dict)
        self.assertNotIn("automated", spec_prod.get("syncPolicy", {}))

        # Check Root App-of-Apps
        root = load_yaml(self.repo_root / "deploy" / "argocd" / "root-app-of-apps.yaml")
        assert isinstance(root, dict)
        self.assertEqual(root.get("kind"), "Application")

    def test_environment_overlays(self) -> None:
        """Staging and production values overlays must declare environment name, image tags, and valid YAML."""
        issues = validate_environment_overlays(self.repo_root)
        self.assertEqual(issues, [], f"Environment overlays validation failed: {issues}")

        staging_val = load_yaml(self.repo_root / "deploy" / "environments" / "staging" / "values.yaml")
        assert isinstance(staging_val, dict)
        glob_stg = staging_val.get("global", {})
        assert isinstance(glob_stg, dict)
        self.assertEqual(glob_stg.get("environment"), "staging")
        api_stg = staging_val.get("api", {})
        assert isinstance(api_stg, dict)
        img_stg = api_stg.get("image", {})
        assert isinstance(img_stg, dict)
        self.assertTrue(img_stg.get("tag"))

        prod_val = load_yaml(self.repo_root / "deploy" / "environments" / "production" / "values.yaml")
        assert isinstance(prod_val, dict)
        glob_prod = prod_val.get("global", {})
        assert isinstance(glob_prod, dict)
        self.assertEqual(glob_prod.get("environment"), "production")
        api_prod = prod_val.get("api", {})
        assert isinstance(api_prod, dict)
        img_prod = api_prod.get("image", {})
        assert isinstance(img_prod, dict)
        self.assertTrue(img_prod.get("tag"))
        gpu_prod = prod_val.get("gpu", {})
        assert isinstance(gpu_prod, dict)
        self.assertTrue(gpu_prod.get("enabled"))


if __name__ == "__main__":
    unittest.main()
