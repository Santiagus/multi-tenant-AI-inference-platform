#!/usr/bin/env python3
"""Unit tests for M02 Local Platform Skeleton infrastructure."""

from pathlib import Path
import unittest


class TestPlatformSkeleton(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parent.parent.parent

    def test_docker_compose_structure(self) -> None:
        compose_file = self.repo_root / "docker-compose.yml"
        self.assertTrue(compose_file.is_file(), "docker-compose.yml must exist")

        content = compose_file.read_text(encoding="utf-8")
        required_services = ["postgres:", "minio:", "elasticmq:", "api:"]
        for svc in required_services:
            self.assertIn(svc, content, f"docker-compose.yml must declare {svc}")

        self.assertIn("platform-artifacts", content, "MinIO bucket must be configured")
        self.assertIn("inference-jobs", content, "Queue configuration must be referenced")

    def test_elasticmq_configuration(self) -> None:
        conf_file = self.repo_root / "deploy" / "compose" / "elasticmq.conf"
        self.assertTrue(conf_file.is_file(), "elasticmq.conf must exist")

        content = conf_file.read_text(encoding="utf-8")
        self.assertIn("inference-jobs", content)
        self.assertIn("inference-jobs-dlq", content)
        self.assertIn("defaultVisibilityTimeout", content)

    def test_sql_migrations_exist(self) -> None:
        migrations_dir = self.repo_root / "apps" / "api" / "src" / "infrastructure" / "db" / "migrations"
        self.assertTrue(migrations_dir.is_dir(), "migrations directory must exist")

        sql_files = list(migrations_dir.glob("*.sql"))
        self.assertGreaterEqual(len(sql_files), 1, "At least one SQL migration must exist")

        init_sql = (migrations_dir / "001_initial_schema.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS tenants", init_sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS api_keys", init_sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS jobs", init_sql)
        self.assertIn("idx_jobs_tenant_id", init_sql)

    def test_apps_api_structure(self) -> None:
        api_root = self.repo_root / "apps" / "api"
        self.assertTrue((api_root / "package.json").is_file())
        self.assertTrue((api_root / "tsconfig.json").is_file())
        self.assertTrue((api_root / "Dockerfile").is_file())
        self.assertTrue((api_root / "src" / "app.ts").is_file())
        self.assertTrue((api_root / "src" / "server.ts").is_file())


if __name__ == "__main__":
    unittest.main()

