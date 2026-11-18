import type { JobItem } from '../../types';

/** Measured cold-start vs inference timing extracted from worker metadata + job timestamps. */
export interface JobTimingBreakdown {
  /** Inference / forward-pass only (job.duration_ms / metadata.inference_ms). */
  inferenceMs: number | null;
  /** Cold model + HF/Diffusers pipe load (0 when warm). */
  modelLoadMs: number | null;
  /** Synthetic ModelLoader portion of cold start (excludes HF pipe). */
  loaderLoadMs: number | null;
  /** HF/Diffusers/transformers from_pretrained + device place. */
  pipeLoadMs: number | null;
  /** model_load_ms + inference_ms when both known. */
  totalProviderMs: number | null;
  /** started_at → completed_at wall clock (includes queue handoff / artifact I/O). */
  wallMs: number | null;
  warmStart: boolean | null;
  tokensPerSec: number | null;
  ttftMs: number | null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function jobMetadata(job: JobItem): Record<string, unknown> {
  const result = (job.result ?? {}) as Record<string, unknown>;
  const nested = result.metadata;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return {};
}

/** Human-readable duration: ms below 1s, otherwise seconds with one decimal. */
export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function resolveJobTiming(job: JobItem): JobTimingBreakdown {
  const metadata = jobMetadata(job);
  const inferenceMs =
    asFiniteNumber(metadata.inference_ms) ??
    asFiniteNumber(job.duration_ms);
  const modelLoadMs = asFiniteNumber(metadata.model_load_ms);
  const loaderLoadMs = asFiniteNumber(metadata.loader_load_ms);
  const pipeLoadMs = asFiniteNumber(metadata.pipe_load_ms);
  const totalFromMeta = asFiniteNumber(metadata.total_provider_ms);
  const totalProviderMs =
    totalFromMeta ??
    (inferenceMs !== null || modelLoadMs !== null
      ? (modelLoadMs ?? 0) + (inferenceMs ?? 0)
      : null);

  let wallMs: number | null = null;
  if (job.started_at && job.completed_at) {
    const started = Date.parse(job.started_at);
    const completed = Date.parse(job.completed_at);
    if (Number.isFinite(started) && Number.isFinite(completed) && completed >= started) {
      wallMs = completed - started;
    }
  }

  const warmRaw = metadata.warm_start;
  const warmStart = typeof warmRaw === 'boolean' ? warmRaw : null;

  return {
    inferenceMs,
    modelLoadMs,
    loaderLoadMs,
    pipeLoadMs,
    totalProviderMs,
    wallMs,
    warmStart,
    tokensPerSec: asFiniteNumber(metadata.tokens_per_sec),
    ttftMs: asFiniteNumber(metadata.ttft_ms),
  };
}
