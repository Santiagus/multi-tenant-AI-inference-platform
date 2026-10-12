-- Schema Migration: 003_observability_correlation.sql
-- Adds correlation_id and traceparent columns for M05 End-to-End Observability

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(128),
    ADD COLUMN IF NOT EXISTS traceparent VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_jobs_correlation_id ON jobs(correlation_id) WHERE correlation_id IS NOT NULL;

