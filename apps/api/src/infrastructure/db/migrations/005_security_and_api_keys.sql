-- Schema Migration: 005_security_and_api_keys.sql
-- M09 Security: Enhanced API key lifecycle, ABAC metadata, and Security Audit Logs

ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS name VARCHAR(255) DEFAULT 'Default API Key',
    ADD COLUMN IF NOT EXISTS key_prefix VARCHAR(32) DEFAULT 'ak_live_default',
    ADD COLUMN IF NOT EXISTS hashed_secret VARCHAR(255),
    ADD COLUMN IF NOT EXISTS allowed_models JSONB,
    ADD COLUMN IF NOT EXISTS rate_limit_per_minute INT NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill hashed_secret from key_hash if null
UPDATE api_keys
SET hashed_secret = encode(sha256(key_hash::bytea), 'hex')
WHERE hashed_secret IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_hashed_secret ON api_keys(hashed_secret);

-- Security Audit Logs Table
CREATE TABLE IF NOT EXISTS security_audit_logs (
    id UUID PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id VARCHAR(64) NOT NULL,
    action VARCHAR(128) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(255),
    outcome VARCHAR(32) NOT NULL,
    reason TEXT,
    actor_key_id VARCHAR(64),
    actor_ip VARCHAR(64),
    actor_user_agent TEXT,
    correlation_id VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_timestamp ON security_audit_logs(tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON security_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation_id ON security_audit_logs(correlation_id) WHERE correlation_id IS NOT NULL;

