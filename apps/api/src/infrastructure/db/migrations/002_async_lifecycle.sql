-- Schema Migration: 002_async_lifecycle.sql
-- Adds request_hash and max_retries columns for M03 Async Inference Lifecycle

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS max_retries INT NOT NULL DEFAULT 3;

