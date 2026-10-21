-- Schema Migration: 004_job_progress.sql
-- Adds progress JSONB and progress_pct INT columns for granular REST polling inference feedback

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS progress JSONB,
    ADD COLUMN IF NOT EXISTS progress_pct INT DEFAULT 0;

