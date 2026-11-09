-- Schema Migration: 007_job_expiration.sql
-- Adds expires_at column to jobs for queue timeout, stale job expiration, and manual retry

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill existing jobs with expires_at = created_at + INTERVAL '24 hours' where null
UPDATE jobs
SET expires_at = created_at + INTERVAL '24 hours'
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_status_expires_at ON jobs(status, expires_at);
