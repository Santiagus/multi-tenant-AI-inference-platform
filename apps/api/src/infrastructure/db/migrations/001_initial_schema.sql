-- Schema Migration: 001_initial_schema.sql
-- Multi-Tenant AI Inference Platform Baseline Schema

CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    tier VARCHAR(32) NOT NULL DEFAULT 'standard',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL,
    scopes JSONB NOT NULL DEFAULT '["read", "write"]'::jsonb,
    revoked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(255),
    model_id VARCHAR(255) NOT NULL,
    routing_preference VARCHAR(32) NOT NULL DEFAULT 'auto',
    priority INT NOT NULL DEFAULT 5,
    status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
    input_payload JSONB,
    input_uri TEXT,
    output_payload JSONB,
    output_uri TEXT,
    error_code VARCHAR(64),
    error_message TEXT,
    provider VARCHAR(64),
    duration_ms INT,
    tokens_in INT,
    tokens_out INT,
    cost_microcents BIGINT,
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance & Isolation Indexes
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_id ON jobs(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_tenant_idempotency ON jobs(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys(tenant_id);

-- Default Tenant & Key Seed for Local/Dev
INSERT INTO tenants (id, name, tier, status)
VALUES ('tenant-default', 'Default Development Tenant', 'standard', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO api_keys (id, tenant_id, key_hash, scopes)
VALUES ('key-default', 'tenant-default', 'dev-secret-key', '["read", "write"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

