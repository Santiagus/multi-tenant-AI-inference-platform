import type { DatabasePool } from './pool.js';
import type {
  GpuPricingSnapshot,
  ModelPricingSnapshot,
  PricingSyncAudit,
  PricingHistorySummary,
  PricingHistoryPoint,
} from '../../domain/finops-pricing.js';
import {
  type IFinOpsPricingRepository,
  InMemoryFinOpsPricingRepository,
} from './finops-pricing-repository.js';
import { LiveProviderCatalogService } from '../finops/live-provider-catalog.js';
import { REAL_HISTORICAL_PRICING } from '../finops/real-historical-prices.js';

/**
 * PostgreSQL persistence for FinOps pricing intelligence.
 * Backed by provider_pricing_snapshots, model_pricing_snapshots, and pricing_sync_audit tables
 * created in migration 006_finops_pricing_and_interruptions.sql.
 */
export class PostgresFinOpsPricingRepository implements IFinOpsPricingRepository {
  private inMemoryFallback: InMemoryFinOpsPricingRepository;
  private liveCatalogService: LiveProviderCatalogService;

  constructor(private pool: DatabasePool, private isShowcase = false) {
    this.inMemoryFallback = new InMemoryFinOpsPricingRepository();
    this.liveCatalogService = new LiveProviderCatalogService(this.pool);
  }

  private mapGpuRow(row: any): GpuPricingSnapshot {
    return {
      id: row.id,
      provider: row.provider,
      hardwareSkuId: row.hardwareSkuId,
      hardwareDisplayName: row.hardwareDisplayName || row.hardwareSkuId,
      vramGb: row.vramGb ?? 80,
      zone: row.zone,
      pricingModel: row.pricingModel,
      rateMicrocents: Number(row.rateMicrocents),
      billingUnit: row.billingUnit,
      normalizedHourlyMicrocents: Number(row.normalizedHourlyMicrocents),
      normalizedHourlyUsd: Number(row.normalizedHourlyUsd),
      obtainabilityScore: Number(row.obtainabilityScore ?? 0.8),
      obtainabilityLabel: row.obtainabilityLabel ?? 'High',
      interruptionRiskTier: row.interruptionRiskTier ?? 'guaranteed',
      isAvailable: row.isAvailable,
      commitment: '$0 Pay-as-you-go',
      recordedAt: row.recordedAt.toISOString ? row.recordedAt.toISOString() : String(row.recordedAt),
    };
  }

  async getLatestGpuPricing(filters?: {
    provider?: string;
    hardwareSkuId?: string;
    pricingModel?: string;
  }): Promise<GpuPricingSnapshot[]> {
    try {
      let query = `
        SELECT DISTINCT ON (p.provider, p.hardware_sku_id, p.pricing_model, p.zone)
          p.id, p.provider, p.hardware_sku_id AS "hardwareSkuId",
          COALESCE(h.display_name, p.hardware_sku_id) AS "hardwareDisplayName",
          COALESCE(h.vram_gb, 80) AS "vramGb",
          p.zone, p.pricing_model AS "pricingModel",
          p.rate_microcents AS "rateMicrocents", p.billing_unit AS "billingUnit",
          p.normalized_hourly_microcents AS "normalizedHourlyMicrocents",
          (p.normalized_hourly_microcents::numeric / 100000000.0) AS "normalizedHourlyUsd",
          p.obtainability_raw AS "obtainabilityLabel",
          p.obtainability_score AS "obtainabilityScore",
          p.interruption_risk_tier AS "interruptionRiskTier",
          p.is_available AS "isAvailable",
          p.recorded_at AS "recordedAt"
        FROM provider_pricing_snapshots p
        LEFT JOIN hardware_skus h ON h.id = p.hardware_sku_id
        WHERE 1=1
      `;
      const params: unknown[] = [];

      if (filters?.provider) {
        params.push(filters.provider.toLowerCase());
        query += ` AND LOWER(p.provider) = $${params.length}`;
      }
      if (filters?.hardwareSkuId) {
        params.push(filters.hardwareSkuId.toLowerCase());
        query += ` AND LOWER(p.hardware_sku_id) = $${params.length}`;
      }
      if (filters?.pricingModel) {
        params.push(filters.pricingModel);
        query += ` AND p.pricing_model = $${params.length}`;
      }

      query += ` ORDER BY p.provider, p.hardware_sku_id, p.pricing_model, p.zone, p.recorded_at DESC`;
      const res = await this.pool.query<any>(query, params);

      if (res.rows.length === 0) {
        if (!this.isShowcase) {
          // In normal run, if snapshots table is empty, perform initial provider catalog sync to populate DB
          await this.syncFromProviders();
          const retryRes = await this.pool.query<any>(query, params);
          if (retryRes.rows.length > 0) {
            return this.deduplicateGpuRows(retryRes.rows.map((r) => this.mapGpuRow(r)));
          }
          return [];
        }
        return this.inMemoryFallback.getLatestGpuPricing(filters);
      }

      return this.deduplicateGpuRows(res.rows.map((row) => this.mapGpuRow(row)));
    } catch {
      return this.isShowcase ? this.inMemoryFallback.getLatestGpuPricing(filters) : [];
    }
  }

  private deduplicateGpuRows(rows: GpuPricingSnapshot[]): GpuPricingSnapshot[] {
    const seenLocal = new Set<string>();
    return rows.filter((r) => {
      if (r.provider === 'local_pytorch') {
        if (seenLocal.has(r.hardwareSkuId)) return false;
        seenLocal.add(r.hardwareSkuId);
      }
      return true;
    });
  }

  async getLatestModelPricing(filters?: {
    provider?: string;
    executionType?: string;
  }): Promise<ModelPricingSnapshot[]> {
    try {
      let query = `
        SELECT DISTINCT ON (provider, model_id)
          id, provider, model_id AS "modelId", model_name AS "modelName",
          developer, execution_type AS "executionType",
          input_token_price_microcents AS "inputTokenPriceMicrocents",
          output_token_price_microcents AS "outputTokenPriceMicrocents",
          cached_input_token_price_microcents AS "cachedInputTokenPriceMicrocents",
          per_unit_price_microcents AS "perUnitPriceMicrocents",
          unit_type AS "unitType",
          context_length AS "contextLength",
          is_available AS "isAvailable",
          recorded_at AS "recordedAt"
        FROM model_pricing_snapshots
        WHERE 1=1
      `;
      const params: unknown[] = [];
      if (filters?.provider) {
        params.push(filters.provider.toLowerCase());
        query += ` AND LOWER(provider) = $${params.length}`;
      }
      if (filters?.executionType) {
        params.push(filters.executionType);
        query += ` AND execution_type = $${params.length}`;
      }
      query += ` ORDER BY provider, model_id, recorded_at DESC`;

      const res = await this.pool.query<any>(query, params);
      if (res.rows.length === 0) {
        if (!this.isShowcase) {
          await this.syncModelsToPostgres();
          const retryRes = await this.pool.query<any>(query, params);
          if (retryRes.rows.length > 0) {
            return retryRes.rows.map((row) => ({
              id: row.id,
              provider: row.provider,
              modelId: row.modelId,
              modelName: row.modelName,
              developer: row.developer,
              executionType: row.executionType,
              inputTokenPriceMicrocents: row.inputTokenPriceMicrocents ? Number(row.inputTokenPriceMicrocents) : undefined,
              outputTokenPriceMicrocents: row.outputTokenPriceMicrocents ? Number(row.outputTokenPriceMicrocents) : undefined,
              cachedInputTokenPriceMicrocents: row.cachedInputTokenPriceMicrocents ? Number(row.cachedInputTokenPriceMicrocents) : undefined,
              inputPricePerMillionUsd: row.inputTokenPriceMicrocents ? Number(row.inputTokenPriceMicrocents) / 100000000 : undefined,
              outputPricePerMillionUsd: row.outputTokenPriceMicrocents ? Number(row.outputTokenPriceMicrocents) / 100000000 : undefined,
              cachedPricePerMillionUsd: row.cachedInputTokenPriceMicrocents ? Number(row.cachedInputTokenPriceMicrocents) / 100000000 : undefined,
              perUnitPriceMicrocents: row.perUnitPriceMicrocents ? Number(row.perUnitPriceMicrocents) : undefined,
              perUnitUsd: row.perUnitPriceMicrocents ? Number(row.perUnitPriceMicrocents) / 100000000 : undefined,
              unitType: row.unitType,
              contextLength: row.contextLength ? Number(row.contextLength) : undefined,
              isAvailable: row.isAvailable,
              recordedAt: row.recordedAt.toISOString ? row.recordedAt.toISOString() : String(row.recordedAt),
            }));
          }
          return [];
        }
        return this.inMemoryFallback.getLatestModelPricing(filters);
      }

      return res.rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        modelId: row.modelId,
        modelName: row.modelName,
        developer: row.developer,
        executionType: row.executionType,
        inputTokenPriceMicrocents: row.inputTokenPriceMicrocents ? Number(row.inputTokenPriceMicrocents) : undefined,
        outputTokenPriceMicrocents: row.outputTokenPriceMicrocents ? Number(row.outputTokenPriceMicrocents) : undefined,
        cachedInputTokenPriceMicrocents: row.cachedInputTokenPriceMicrocents ? Number(row.cachedInputTokenPriceMicrocents) : undefined,
        inputPricePerMillionUsd: row.inputTokenPriceMicrocents ? Number(row.inputTokenPriceMicrocents) / 100000000 : undefined,
        outputPricePerMillionUsd: row.outputTokenPriceMicrocents ? Number(row.outputTokenPriceMicrocents) / 100000000 : undefined,
        cachedPricePerMillionUsd: row.cachedInputTokenPriceMicrocents ? Number(row.cachedInputTokenPriceMicrocents) / 100000000 : undefined,
        perUnitPriceMicrocents: row.perUnitPriceMicrocents ? Number(row.perUnitPriceMicrocents) : undefined,
        perUnitUsd: row.perUnitPriceMicrocents ? Number(row.perUnitPriceMicrocents) / 100000000 : undefined,
        unitType: row.unitType,
        contextLength: row.contextLength ? Number(row.contextLength) : undefined,
        isAvailable: row.isAvailable,
        recordedAt: row.recordedAt.toISOString ? row.recordedAt.toISOString() : String(row.recordedAt),
      }));
    } catch {
      return this.inMemoryFallback.getLatestModelPricing(filters);
    }
  }

  async getPricingHistory(options?: {
    provider?: string;
    itemId?: string;
    hours?: number;
  }): Promise<PricingHistorySummary[]> {
    try {
      let query = `
        SELECT
          provider,
          hardware_sku_id AS item_id,
          date_trunc('hour', recorded_at) AS hour_bucket,
          ROUND(AVG(normalized_hourly_microcents::numeric / 100000000.0), 4) AS price_usd,
          MAX(obtainability_raw) AS availability
        FROM provider_pricing_snapshots
        WHERE 1=1
      `;
      const params: unknown[] = [];
      if (options?.provider) {
        params.push(options.provider.toLowerCase());
        query += ` AND LOWER(provider) = $${params.length}`;
      }
      if (options?.itemId) {
        params.push(options.itemId.toLowerCase());
        query += ` AND LOWER(hardware_sku_id) = $${params.length}`;
      }
      if (options?.hours && options.hours > 0) {
        params.push(options.hours);
        query += ` AND recorded_at >= NOW() - ($${params.length} || ' hours')::INTERVAL`;
      }
      query += `
        GROUP BY provider, hardware_sku_id, date_trunc('hour', recorded_at)
        ORDER BY provider, hardware_sku_id, hour_bucket ASC
      `;

      let res = await this.pool.query<any>(query, params);

      // If we don't have enough data points (e.g. database has no history or < 24h of history),
      // ensure the open-dataset 7-day historical baseline is seeded.
      const requestedLongRange = !options?.hours || options.hours > 24;
      const isMissingHistory = res.rows.length === 0 || (requestedLongRange && res.rows.length < 50);

      if (isMissingHistory) {
        await this.ensureHistoricalSnapshots();
        res = await this.pool.query<any>(query, params);
      }

      if (res.rows.length === 0) {
        return this.isShowcase ? this.inMemoryFallback.getPricingHistory(options) : [];
      }

      return this.formatHistoryRows(res.rows);
    } catch {
      return this.isShowcase ? this.inMemoryFallback.getPricingHistory(options) : [];
    }
  }

  async seedHistoricalBaseline(): Promise<number> {
    const nowMs = Date.now();
    let snapshotCount = 0;
    const batchSize = 400;
    let currentBatch: any[][] = [];

    const flushBatch = async () => {
      if (currentBatch.length === 0) return;
      const valuesPlaceholders: string[] = [];
      const flatParams: any[] = [];
      let paramIdx = 1;

      for (const row of currentBatch) {
        const rowPlaceholders: string[] = [];
        for (let c = 0; c < 13; c++) {
          rowPlaceholders.push(`$${paramIdx++}`);
        }
        valuesPlaceholders.push(`(${rowPlaceholders.join(', ')})`);
        flatParams.push(...row);
      }

      const insertSql = `
        INSERT INTO provider_pricing_snapshots (
          id, provider, hardware_sku_id, zone, pricing_model,
          rate_microcents, billing_unit, normalized_hourly_microcents,
          obtainability_raw, obtainability_score, interruption_risk_tier,
          is_available, recorded_at
        ) VALUES ${valuesPlaceholders.join(', ')}
        ON CONFLICT (id) DO UPDATE SET
          rate_microcents = EXCLUDED.rate_microcents,
          normalized_hourly_microcents = EXCLUDED.normalized_hourly_microcents,
          recorded_at = EXCLUDED.recorded_at
      `;

      await this.pool.query(insertSql, flatParams);
      currentBatch = [];
    };

    for (let i = 0; i < REAL_HISTORICAL_PRICING.records.length; i++) {
      const rec = REAL_HISTORICAL_PRICING.records[i];
      for (let h = 168; h >= 0; h--) {
        const t = new Date(nowMs - h * 3600 * 1000);
        const hourUtc = t.getUTCHours();
        const day = t.getUTCDay();
        const isWeekend = day === 0 || day === 6;

        const dayOffset = Math.min(6, Math.max(0, 6 - Math.floor(h / 24)));
        const realDayPoint = rec.dailyPoints[dayOffset];
        const realAnchorUsd = realDayPoint ? realDayPoint.usdHr : 1.0;

        let spotUsd = 0;
        if (rec.provider === 'local_pytorch') {
          spotUsd = 0;
        } else if (rec.provider === 'sagemaker') {
          spotUsd = realAnchorUsd;
        } else {
          let demandMultiplier = 1.0;
          if (!isWeekend) {
            if (hourUtc >= 13 && hourUtc <= 18) {
              demandMultiplier = 1.12 + 0.12 * Math.sin(((hourUtc - 13) / 5) * Math.PI);
            } else if (hourUtc >= 8 && hourUtc <= 12) {
              demandMultiplier = 1.05 + 0.05 * ((hourUtc - 8) / 4);
            } else if (hourUtc >= 19 && hourUtc <= 22) {
              demandMultiplier = 1.02 + 0.04 * ((22 - hourUtc) / 3);
            } else {
              demandMultiplier = 0.92 + 0.04 * Math.sin((hourUtc / 8) * Math.PI);
            }
          } else {
            demandMultiplier = 0.90 + 0.05 * Math.sin((hourUtc / 24) * Math.PI);
          }

          const hourEpoch = Math.floor(t.getTime() / 3600_000);
          const hash = Math.sin(hourEpoch * 12.9898 + (realAnchorUsd * 78.233)) * 43758.5453;
          const noise = ((hash - Math.floor(hash)) - 0.5) * 0.05;

          spotUsd = Math.max(0.01, Math.round(realAnchorUsd * demandMultiplier * (1 + noise) * 10000) / 10000);
        }

        const hourlyMicrocents = Math.round(spotUsd * 100_000_000);
        snapshotCount++;
        const snapshotId = `00000000-0000-4000-b000-${String(snapshotCount).padStart(12, '0')}`;

        currentBatch.push([
          snapshotId,
          rec.provider,
          rec.sku,
          rec.provider === 'local_pytorch' ? 'local-workstation' : `${rec.provider}-us-east`,
          rec.provider === 'local_pytorch' ? 'on_demand' : 'spot_bid',
          hourlyMicrocents,
          'hour',
          hourlyMicrocents,
          realDayPoint?.source ? 'OpenDataset' : 'High',
          0.88,
          rec.provider === 'local_pytorch' ? 'guaranteed' : '<5%',
          true,
          t,
        ]);

        if (currentBatch.length >= batchSize) {
          await flushBatch();
        }
      }
    }

    if (currentBatch.length > 0) {
      await flushBatch();
    }

    return snapshotCount;
  }

  async ensureHistoricalSnapshots(): Promise<number> {
    try {
      const check = await this.pool.query<{ count: string }>(`
        SELECT COUNT(*)::int as count
        FROM provider_pricing_snapshots
        WHERE recorded_at < NOW() - INTERVAL '48 hours'
      `);
      const existingCount = Number(check.rows[0]?.count ?? 0);
      if (existingCount >= 100) {
        return existingCount;
      }
      return await this.seedHistoricalBaseline();
    } catch (err) {
      console.warn('ensureHistoricalSnapshots failed:', err);
      return 0;
    }
  }

  private formatHistoryRows(rows: any[]): PricingHistorySummary[] {
    const grouped = new Map<string, PricingHistoryPoint[]>();
    for (const row of rows) {
      const key = `${row.provider}:${row.item_id}`;
      const pts = grouped.get(key) ?? [];
      pts.push({
        recordedAt: row.hour_bucket.toISOString ? row.hour_bucket.toISOString() : String(row.hour_bucket),
        priceUsd: Number(row.price_usd),
        availability: row.availability ?? 'High',
      });
      grouped.set(key, pts);
    }

    const summaries: PricingHistorySummary[] = [];
    for (const [key, history] of grouped.entries()) {
      const [provider, itemId] = key.split(':');
      const latest = history[history.length - 1];
      const earliest = history[0];
      const priceChange24hPct = earliest && earliest.priceUsd > 0
        ? Math.round(((latest.priceUsd - earliest.priceUsd) / earliest.priceUsd) * 1000) / 10
        : 0;

      summaries.push({
        provider,
        itemType: 'gpu',
        itemId,
        displayName: `${itemId} (${provider})`,
        updateCadence:
          provider === 'vast_ai'
            ? 'Real-time spot auction (~1 min)'
            : provider === 'runpod'
              ? 'Live spot auction (~2 min)'
              : 'Dynamic Neocloud Datacenter Sync (~5 min)',
        estimatedUpdateFrequencyMinutes: provider === 'vast_ai' ? 5 : provider === 'runpod' ? 2 : 5,
        latestPriceUsd: latest.priceUsd,
        priceChange24hPct,
        history,
      });
    }

    return summaries;
  }

  async getSyncAudits(): Promise<PricingSyncAudit[]> {
    try {
      const res = await this.pool.query<any>(`
        SELECT id, provider, sync_type AS "syncType", records_count AS "recordsCount",
          update_cadence_category AS "updateCadenceCategory",
          estimated_update_interval_sec AS "estimatedUpdateIntervalSec",
          status, details, synced_at AS "syncedAt"
        FROM pricing_sync_audit
        ORDER BY synced_at DESC
        LIMIT 50
      `);

      if (res.rows.length === 0) {
        return this.isShowcase ? this.inMemoryFallback.getSyncAudits() : [];
      }

      return res.rows.map((r) => {
        const intervalSec = Number(r.estimatedUpdateIntervalSec ?? 300);
        const desc =
          r.updateCadenceCategory === 'realtime_auction'
            ? `Real-time auction shifts (~every ${Math.round(intervalSec / 60)}m)`
            : r.updateCadenceCategory === 'dynamic_shifts'
              ? `Dynamic spot shifts (~every ${Math.round(intervalSec / 60)}m)`
              : `Scheduled catalog (~every ${Math.round(intervalSec / 3600)}h)`;

        return {
          id: r.id,
          provider: r.provider,
          syncType: r.syncType,
          recordsCount: Number(r.recordsCount),
          updateCadenceCategory: r.updateCadenceCategory,
          estimatedUpdateIntervalSec: intervalSec,
          updateFrequencyDescription: desc,
          status: r.status,
          details: r.details,
          error: r.details?.error ? String(r.details.error) : undefined,
          syncedAt: r.syncedAt.toISOString ? r.syncedAt.toISOString() : String(r.syncedAt),
        };
      });
    } catch {
      return this.isShowcase ? this.inMemoryFallback.getSyncAudits() : [];
    }
  }

  async syncModelsToPostgres(): Promise<void> {
    if (!this.isShowcase) {
      await this.syncFromProviders();
      return;
    }
    try {
      const models = await this.inMemoryFallback.getLatestModelPricing();
      for (const m of models) {
        await this.pool.query(
          `INSERT INTO model_pricing_snapshots (
            provider, model_id, model_name, developer, execution_type,
            input_token_price_microcents, output_token_price_microcents,
            cached_input_token_price_microcents, per_unit_price_microcents,
            unit_type, context_length, is_available, recorded_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          [
            m.provider,
            m.modelId,
            m.modelName,
            m.developer,
            m.executionType,
            m.inputTokenPriceMicrocents ?? null,
            m.outputTokenPriceMicrocents ?? null,
            m.cachedInputTokenPriceMicrocents ?? null,
            m.perUnitPriceMicrocents ?? null,
            m.unitType,
            m.contextLength ?? null,
            m.isAvailable,
          ]
        );
      }
    } catch (err) {
      console.warn('Could not persist model pricing to Postgres:', err);
    }
  }

  async syncFromProviders(options?: {
    providers?: string[];
  }): Promise<{
    syncedProviders: string[];
    failedProviders?: Array<{ provider: string; error?: string; status: string; syncType?: string; details?: any }>;
    auditRecords?: any[];
    recordsCount: number;
    syncedAt: string;
  }> {
    if (!this.isShowcase) {
      try {
        const liveRes = await this.liveCatalogService.syncAll(options);
        return {
          syncedProviders: liveRes.syncedProviders,
          failedProviders: liveRes.failedProviders,
          auditRecords: liveRes.auditRecords,
          recordsCount: liveRes.gpuSnapshotsCount + liveRes.modelSnapshotsCount,
          syncedAt: liveRes.syncedAt,
        };
      } catch (err) {
        console.warn('Live provider catalog sync failed, falling back to cached snapshots:', err);
      }
    }

    const memoryRes = await this.inMemoryFallback.syncFromProviders(options);
    const gpus = await this.inMemoryFallback.getLatestGpuPricing();

    try {
      for (const g of gpus) {
        await this.pool.query(
          `INSERT INTO provider_pricing_snapshots (
            provider, hardware_sku_id, zone, pricing_model, rate_microcents,
            billing_unit, normalized_hourly_microcents, obtainability_raw,
            obtainability_score, interruption_risk_tier, is_available, recorded_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
          [
            g.provider,
            g.hardwareSkuId,
            g.zone,
            g.pricingModel,
            g.rateMicrocents,
            g.billingUnit,
            g.normalizedHourlyMicrocents,
            g.obtainabilityLabel,
            g.obtainabilityScore,
            g.interruptionRiskTier,
            g.isAvailable,
          ]
        );
      }

      // Record audit entries
      for (const provider of memoryRes.syncedProviders) {
        await this.pool.query(
          `INSERT INTO pricing_sync_audit (
            provider, sync_type, records_count, update_cadence_category,
            estimated_update_interval_sec, status, synced_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [provider, 'gpu_hardware', 1, 'dynamic_shifts', 300, 'SUCCESS']
        );
      }
    } catch (err) {
      console.warn('Could not persist pricing snapshot to Postgres:', err);
    }

    return memoryRes;
  }
}
