-- Schema Migration: 006_finops_pricing_and_interruptions.sql
-- FinOps & Neocloud Intelligence: Hardware SKUs, Pricing Snapshots, and Spot Eviction Ledger

-- 1. Static Hardware Catalog
CREATE TABLE IF NOT EXISTS hardware_skus (
    id VARCHAR(64) PRIMARY KEY,                 -- e.g. 'nvidia-rtx-4090', 'nvidia-a100-80gb', 'nvidia-l4', 'nvidia-h100-sxm'
    display_name VARCHAR(128) NOT NULL,
    vendor VARCHAR(64) NOT NULL DEFAULT 'nvidia',
    architecture VARCHAR(64),                   -- 'Ada Lovelace', 'Ampere', 'Hopper', 'Blackwell'
    vram_gb INT NOT NULL,
    fp16_tflops NUMERIC(8, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed Baseline Accelerator SKUs
INSERT INTO hardware_skus (id, display_name, vendor, architecture, vram_gb, fp16_tflops)
VALUES
    ('nvidia-rtx-5070-ti', 'NVIDIA GeForce RTX 5070 Ti', 'nvidia', 'Blackwell', 16, 95.0),
    ('nvidia-rtx-5090', 'NVIDIA GeForce RTX 5090', 'nvidia', 'Blackwell', 32, 190.0),
    ('nvidia-rtx-4090', 'NVIDIA GeForce RTX 4090', 'nvidia', 'Ada Lovelace', 24, 82.6),
    ('nvidia-rtx-3090', 'NVIDIA GeForce RTX 3090', 'nvidia', 'Ampere', 24, 71.0),
    ('nvidia-rtx-5080', 'NVIDIA GeForce RTX 5080', 'nvidia', 'Blackwell', 16, 115.0),
    ('nvidia-l4', 'NVIDIA L4 Tensor Core', 'nvidia', 'Ada Lovelace', 24, 30.3),
    ('nvidia-l40s', 'NVIDIA L40S', 'nvidia', 'Ada Lovelace', 48, 91.6),
    ('nvidia-a10g', 'NVIDIA A10G', 'nvidia', 'Ampere', 24, 31.2),
    ('nvidia-a100-80gb', 'NVIDIA A100 Tensor Core 80GB', 'nvidia', 'Ampere', 80, 77.97),
    ('nvidia-h100-sxm', 'NVIDIA H100 SXM5 80GB', 'nvidia', 'Hopper', 80, 1979.0),
    ('nvidia-h200-sxm', 'NVIDIA H200 SXM 141GB', 'nvidia', 'Hopper', 141, 1979.0),
    ('nvidia-h100-nvl', 'NVIDIA H100 NVL 94GB', 'nvidia', 'Hopper', 94, 1670.0),
    ('nvidia-rtx-6000-ada', 'NVIDIA RTX 6000 Ada Generation 48GB', 'nvidia', 'Ada Lovelace', 48, 91.1),
    ('nvidia-t4', 'NVIDIA T4 Tensor Core 16GB', 'nvidia', 'Turing', 16, 65.0),
    ('nvidia-v100', 'NVIDIA Tesla V100 32GB', 'nvidia', 'Volta', 32, 125.0),
    ('nvidia-b200', 'NVIDIA Blackwell B200 192GB', 'nvidia', 'Blackwell', 192, 4500.0)
ON CONFLICT (id) DO NOTHING;

-- 2. Time-Series Provider Pricing & Availability Snapshots
CREATE TABLE IF NOT EXISTS provider_pricing_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(64) NOT NULL,              -- 'runpod', 'modal', 'baseten', 'vast_ai', 'nebius', 'aws_bedrock'
    hardware_sku_id VARCHAR(64) REFERENCES hardware_skus(id),
    zone VARCHAR(64) NOT NULL,                  -- 'us-east-1', 'europe-north1-a', 'runpod-ca-1', 'vast-host-219'
    pricing_model VARCHAR(32) NOT NULL,         -- 'serverless', 'on_demand', 'preemptible', 'spot_bid'
    
    -- Normalized Integer Pricing (Microcents: $1.00 = 100,000,000 microcents)
    rate_microcents BIGINT NOT NULL,            -- raw unit price
    billing_unit VARCHAR(16) NOT NULL,          -- 'second', 'minute', 'hour', 'token'
    normalized_hourly_microcents BIGINT NOT NULL, -- common denominator for cross-provider FinOps comparison
    
    -- Real-time Availability & Reliability Signals
    obtainability_raw VARCHAR(32),              -- raw provider value: 'HIGH', 'Score:9', '0.99', 'stockStatus:Low'
    obtainability_score NUMERIC(3, 2),          -- normalized float 0.00 to 1.00
    interruption_risk_tier VARCHAR(16),         -- '<5%', '5-10%', '10-20%', '>20%', 'guaranteed'
    
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_lookup 
    ON provider_pricing_snapshots (provider, hardware_sku_id, zone, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_recorded_at 
    ON provider_pricing_snapshots (recorded_at DESC);

-- 3. Granular Execution Attempt Ledger (Tracks Multitenant Unit Economics per Run)
CREATE TABLE IF NOT EXISTS job_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL DEFAULT 1,
    
    provider VARCHAR(64) NOT NULL,
    hardware_sku_id VARCHAR(64) REFERENCES hardware_skus(id),
    zone VARCHAR(64),
    pricing_model VARCHAR(32) NOT NULL DEFAULT 'on_demand',
    
    worker_node_id VARCHAR(128),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_ms INT,
    
    cost_microcents BIGINT NOT NULL DEFAULT 0,
    billed_revenue_microcents BIGINT NOT NULL DEFAULT 0,
    gross_margin_percentage NUMERIC(5, 2),
    
    status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
    is_preempted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_job_executions_job_id ON job_executions(job_id);
CREATE INDEX IF NOT EXISTS idx_job_executions_finops ON job_executions(provider, pricing_model, is_preempted);

-- 4. Spot Eviction & Compute Waste Tracking
CREATE TABLE IF NOT EXISTS spot_interruptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id UUID NOT NULL REFERENCES job_executions(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    provider VARCHAR(64) NOT NULL,
    hardware_sku_id VARCHAR(64) REFERENCES hardware_skus(id),
    zone VARCHAR(64),
    pricing_model VARCHAR(32) NOT NULL,         -- 'preemptible' or 'spot_bid'
    
    wasted_duration_ms INT NOT NULL,            -- compute duration lost prior to interruption
    wasted_cost_microcents BIGINT NOT NULL,     -- financial cost burned on uncompleted job
    interruption_reason VARCHAR(64),            -- 'OUTBID', 'PREEMPTION', 'SIGTERM_TIMEOUT', 'NODE_DRAIN'
    
    re_routed_to_provider VARCHAR(64),          -- target provider for fallback retry
    re_routed_pricing_model VARCHAR(32),
    interrupted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spot_interruptions_finops 
    ON spot_interruptions (provider, hardware_sku_id, interrupted_at DESC);

-- 5. Open Models & Token Factory Pricing Snapshots
CREATE TABLE IF NOT EXISTS model_pricing_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(64) NOT NULL,              -- 'jarvislabs', 'nebius', 'fal', 'runware', 'bedrock', 'runpod'
    model_id VARCHAR(128) NOT NULL,             -- 'deepseek-v4.1-flash', 'gemma-4-26b', 'qwen-3.8-27b', 'fal-ai/flux/schnell'
    model_name VARCHAR(128) NOT NULL,
    developer VARCHAR(64) NOT NULL,             -- 'DeepSeek', 'Google', 'Alibaba', 'Black Forest Labs', 'Meta'
    execution_type VARCHAR(32) NOT NULL,        -- 'token_factory', 'serverless_endpoint', 'pay_per_call'
    
    -- Integer Microcents Pricing ($1.00 = 100,000,000 microcents)
    input_token_price_microcents BIGINT,        -- per 1M tokens
    output_token_price_microcents BIGINT,       -- per 1M tokens
    cached_input_token_price_microcents BIGINT, -- per 1M tokens
    per_unit_price_microcents BIGINT,           -- per megapixel or per second for media models
    unit_type VARCHAR(32) NOT NULL DEFAULT 'token_1m', -- 'token_1m', 'megapixel', 'compute_second'
    
    context_length INT,                         -- e.g. 1048576 (1M context)
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_pricing_snapshots 
    ON model_pricing_snapshots (provider, model_id, recorded_at DESC);

-- 6. Pricing Sync Audit & Cadence Tracking
CREATE TABLE IF NOT EXISTS pricing_sync_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(64) NOT NULL,
    sync_type VARCHAR(32) NOT NULL,             -- 'gpu_hardware', 'model_tokens', 'media_pricing'
    records_count INT NOT NULL DEFAULT 0,
    update_cadence_category VARCHAR(32) NOT NULL, -- 'realtime_auction' (Vast 5m), 'dynamic_shifts' (RunPod 1h), 'scheduled' (Baseten/Daily)
    estimated_update_interval_sec INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    details JSONB,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_sync_audit 
    ON pricing_sync_audit (provider, synced_at DESC);


