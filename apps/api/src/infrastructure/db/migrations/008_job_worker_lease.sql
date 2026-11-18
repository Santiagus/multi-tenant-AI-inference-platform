-- Schema Migration: 008_job_worker_lease.sql
-- Worker lease columns so orphaned PROCESSING jobs (API restart / crashed child) can be reclaimed
-- before job TTL expires.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS lease_owner TEXT,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_processing_lease
    ON jobs (status, lease_expires_at)
    WHERE status = 'PROCESSING';
