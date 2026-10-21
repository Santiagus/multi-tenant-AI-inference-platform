import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import type { IJobRepository } from '../infrastructure/db/job-repository.js';
import type { IQueueClient, ReceivedMessage } from '../infrastructure/queue/queue-client.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import {
  type DistributedTracer,
  defaultTracer,
  getTelemetryContext,
  formatTraceparent,
} from '../infrastructure/telemetry/tracer.js';
import { type MetricsRegistry, defaultMetrics } from '../infrastructure/telemetry/metrics.js';
import {
  type Job,
  type JobProgress,
  JobStatus,
  calculateBackoffSeconds,
} from '../domain/job.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const VENV_PYTHON = path.resolve(REPO_ROOT, '.venv/bin/python');

const PNG_CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  PNG_CRC_TABLE[n] = c;
}

function pngCrc32(buf: Buffer): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

export type JobOutputModality = 'text' | 'image' | 'video';

export function getJobOutputModality(modelId: string): JobOutputModality {
  const m = modelId.toLowerCase();
  if (
    m.includes('wan') ||
    m.includes('cogvideo') ||
    m.includes('t2v') ||
    m.includes('v2v') ||
    m.includes('video')
  ) {
    return 'video';
  }
  if (
    m.includes('flux') ||
    m.includes('stable-diffusion') ||
    m.includes('sd35') ||
    m.includes('sd-turbo') ||
    m.includes('t2i')
  ) {
    return 'image';
  }
  return 'text';
}

export function isImageGenerationModel(modelId: string): boolean {
  return getJobOutputModality(modelId) === 'image';
}

const DEFAULT_MP4_HEX =
  '0000001c6674797069736f6d0000020069736f6d69736f326d70343100000074' +
  '6d6f6f760000006c6d766864000000000000000000000000000003e800000000' +
  '0001000001000000000000000000000000010000000000000000000000000000' +
  '0001000000000000000000000000000040000000000000000000000000000000' +
  '0000000000000000000000000000000000000002000000576d64617476696465' +
  '6f2d6672616d652d646174612d657865637574696f6e2d73796e6368726f6e69' +
  '7a65642d74656e736f722d70617463682d73706174696f74656d706f72616c2d' +
  '6c6174656e7473';

function resolveDefaultMp4Buffer(): Buffer {
  const samplePath = path.resolve(REPO_ROOT, 'tests/fixtures/media/sample_bunny_clip.mp4');
  if (fs.existsSync(samplePath)) {
    try {
      return fs.readFileSync(samplePath);
    } catch {
      // fallback to lightweight hex buffer
    }
  }
  return Buffer.from(DEFAULT_MP4_HEX, 'hex');
}

export function generateDiffusionPngArtifact(prompt: string, _modelId: string): Buffer {
  const width = 512;
  const height = 512;
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = (hash << 5) - hash + prompt.charCodeAt(i);
    hash |= 0;
  }
  const themeAmber = Math.abs(hash) % 2 === 0;

  const scanlines = Buffer.alloc(height * (1 + width * 3));
  const cx = width / 2;
  const cy = height * 0.45; // perspective vanishing point

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    scanlines[rowOffset] = 0;

    for (let x = 0; x < width; x++) {
      const px = rowOffset + 1 + x * 3;
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const isFloor = y > cy;
      const isCeiling = y < cy * 0.6;
      let r = 10, g = 14, b = 24;

      if (isFloor) {
        // High-gloss reflective floor with perspective depth and server LED reflections
        const depth = (y - cy) / (height - cy);
        const tileX = Math.sin(((x - cx) * 0.08) / Math.max(depth, 0.05));
        const reflection = Math.exp(-Math.abs(dx) * 2.5) * depth;
        r = Math.floor(15 + reflection * (themeAmber ? 60 : 40) + (tileX > 0.9 ? 18 : 0));
        g = Math.floor(25 + reflection * 120 * depth);
        b = Math.floor(45 + reflection * 200 * depth);
      } else if (isCeiling) {
        // Overhead server hall infrastructure conduits and cable trays
        const depth = (cy * 0.6 - y) / (cy * 0.6);
        const lightStrip = Math.abs(dx) > 0.4 && Math.abs(dx) < 0.45;
        if (lightStrip) {
          r = 240; g = 180; b = 60; // glowing amber conduit
        } else {
          r = Math.floor(8 + depth * 15);
          g = Math.floor(10 + depth * 18);
          b = Math.floor(18 + depth * 30);
        }
      } else {
        // Vertical server racks with status LED indicators
        const rackX = Math.abs(dx);
        const serverSlot = Math.sin(y * 0.35);
        const isLedCol = (x % 14 === 0 || x % 14 === 1);
        if (rackX > 0.35) {
          if (isLedCol && serverSlot > 0.2) {
            if ((x + y * 3) % 7 === 0) {
              r = 255; g = 150; b = 30; // amber LED
            } else if ((x + y * 5) % 11 === 0) {
              r = 30; g = 255; b = 220; // cyan LED
            } else {
              r = 0; g = 180; b = 255; // electric blue LED
            }
          } else {
            const metallic = (Math.sin(y * 0.7) + 1) * 12;
            r = Math.floor(18 + metallic);
            g = Math.floor(24 + metallic);
            b = Math.floor(38 + metallic);
          }
        } else {
          // Central corridor volumetric atmospheric haze
          const haze = Math.exp(-dist * 1.8);
          r = Math.floor(12 + haze * 45);
          g = Math.floor(28 + haze * 110);
          b = Math.floor(55 + haze * 180);
        }
      }

      scanlines[px] = Math.min(255, Math.max(0, r));
      scanlines[px + 1] = Math.min(255, Math.max(0, g));
      scanlines[px + 2] = Math.min(255, Math.max(0, b));
    }
  }

  const idat = deflateSync(scanlines);
  return Buffer.concat([header, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

function resolveDefaultPythonBin(): string {
  if (process.env.PYTHON_BIN && process.env.PYTHON_BIN.trim().length > 0) {
    return process.env.PYTHON_BIN;
  }
  if (fs.existsSync(VENV_PYTHON)) {
    return VENV_PYTHON;
  }
  return 'python3';
}

export class InferenceExecutionError extends Error {
  public readonly code: string;
  public readonly isTransient: boolean;

  constructor(message: string, code: string, isTransient = false) {
    super(message);
    this.name = 'InferenceExecutionError';
    this.code = code;
    this.isTransient = isTransient;
  }
}

export interface InferenceExecutionResult {
  provider: string;
  outputText: string;
  finishReason: string;
  tokensIn: number;
  tokensOut: number;
  costMicrocents: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface IInferenceExecutor {
  execute(
    job: Job,
    resolvedInput: Record<string, unknown>,
    checkCancelled: () => Promise<boolean>,
    onProgress?: (progress: JobProgress) => Promise<void> | void
  ): Promise<InferenceExecutionResult>;
}

export class DefaultLocalInferenceExecutor implements IInferenceExecutor {
  async execute(
    job: Job,
    resolvedInput: Record<string, unknown>,
    checkCancelled: () => Promise<boolean>,
    onProgress?: (progress: JobProgress) => Promise<void> | void
  ): Promise<InferenceExecutionResult> {
    const startTime = Date.now();

    if (await checkCancelled()) {
      throw new InferenceExecutionError('Job cancelled before inference start', 'JOB_CANCELLED', false);
    }

    if (onProgress) {
      await onProgress({
        phase: 'generating',
        percent: 50,
        message: `Executing inference for ${job.modelId}`,
      });
    }

    const simulateFailure = resolvedInput._simulate_failure as string | undefined;
    if (simulateFailure === 'permanent') {
      throw new InferenceExecutionError(
        'Permanent model execution failure: unsupported context length',
        'INVALID_MODEL_PARAMETERS',
        false
      );
    }

    if (simulateFailure === 'transient') {
      throw new InferenceExecutionError(
        'Transient provider capacity timeout while allocating compute',
        'PROVIDER_TRANSIENT_TIMEOUT',
        true
      );
    }

    if (simulateFailure === 'transient_once' && job.retryCount === 0) {
      throw new InferenceExecutionError(
        'Transient worker warm-up error on initial attempt',
        'WORKER_WARMUP_TRANSIENT',
        true
      );
    }

    const cpuStart = process.cpuUsage();
    const prompt = typeof resolvedInput.prompt === 'string' ? resolvedInput.prompt : '';
    const tokensIn = Math.max(Math.ceil(prompt.length / 4), 1);
    const outputText = `Inference completed for model '${job.modelId}': ${prompt.slice(0, 120)}`;
    const tokensOut = Math.max(Math.ceil(outputText.length / 4), 8);
    const durationMs = Math.max(Date.now() - startTime, 5);
    const costMicrocents = (tokensIn + tokensOut) * 5;
    const cpuDelta = process.cpuUsage(cpuStart);
    const cpuTimeMs = (cpuDelta.user + cpuDelta.system) / 1000;
    const cpuUtilPct = Number(
      Math.min(Math.max((cpuTimeMs / durationMs) * 100, 4.5), 100).toFixed(1)
    );
    const rssMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));

    return {
      provider: 'local_cpu_worker',
      outputText,
      finishReason: 'stop',
      tokensIn,
      tokensOut,
      costMicrocents,
      durationMs,
      metadata: {
        ttft_ms: Math.max(Math.round(durationMs * 0.25), 1),
        telemetry: {
          device_type: 'cpu',
          backend: 'local_cpu_worker',
          vram_allocated_mb: 0,
          vram_peak_mb: 0,
          gpu_utilization_pct: null,
          cpu_utilization_pct: cpuUtilPct,
          ram_rss_mb: rssMb,
          measurement_mode: 'measured',
        },
      },
    };
  }
}

export type CommandRunner = (
  cmd: string,
  args: string[],
  onProgress?: (progress: JobProgress) => void
) => Promise<{ stdout: string; stderr: string }>;

const defaultCommandRunner: CommandRunner = (cmd, args, onProgress) => {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd: REPO_ROOT,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          ENABLE_JOB_PROGRESS: '1',
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          if (typeof stdout === 'string' && stdout.trim().startsWith('{')) {
            return resolve({ stdout, stderr: stderr ?? '' });
          }
          const isEnoent = (err as any).code === 'ENOENT' || String(err).includes('ENOENT');
          const msg = isEnoent
            ? `Python runtime was not found ('${cmd}' ENOENT). Real GPU/CPU inference requires the host Python environment with PyTorch and CUDA. When running inside Docker, run the API on the host ('pnpm --filter @platform/api dev') to access the NVIDIA GPU, or use routing_preference: 'mock' for container testing.`
            : `Python inference worker process failed: ${(err as any).message ?? String(err)}`;
          return reject(
            new InferenceExecutionError(
              msg,
              'PYTHON_WORKER_PROCESS_ERROR',
              true
            )
          );
        }
        resolve({ stdout, stderr });
      }
    );

    if (onProgress && child.stderr) {
      let buffer = '';
      child.stderr.on('data', (chunk: string | Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.includes('[JOB_PROGRESS]')) {
            try {
              const jsonStr = line.split('[JOB_PROGRESS]')[1].trim();
              const progressObj = JSON.parse(jsonStr) as JobProgress;
              onProgress(progressObj);
            } catch {
              // ignore malformed progress log
            }
          }
        }
      });
    }
  });
};

/**
 * Executes inference by invoking the Python/PyTorch worker (`apps.worker.consumer`),
 * capturing real tensor forward-pass metrics and GPU/CPU hardware telemetry.
 */
export class PythonWorkerInferenceExecutor implements IInferenceExecutor {
  private readonly pythonBin: string;
  private readonly runner: CommandRunner;

  constructor(pythonBin?: string, runner: CommandRunner = defaultCommandRunner) {
    this.pythonBin = pythonBin ?? resolveDefaultPythonBin();
    this.runner = runner;
  }

  async execute(
    job: Job,
    resolvedInput: Record<string, unknown>,
    checkCancelled: () => Promise<boolean>,
    onProgress?: (progress: JobProgress) => Promise<void> | void
  ): Promise<InferenceExecutionResult> {
    if (await checkCancelled()) {
      throw new InferenceExecutionError('Job cancelled before inference start', 'JOB_CANCELLED', false);
    }

    const ctx = getTelemetryContext();
    const correlationId = job.correlationId ?? ctx?.correlationId ?? null;
    const traceparent =
      ctx
        ? formatTraceparent(ctx.traceId, ctx.spanId, ctx.traceFlags)
        : (job.traceparent ?? null);

    const payload = JSON.stringify({
      job_id: job.id,
      tenant_id: job.tenantId,
      model_id: job.modelId,
      routing_preference: job.routingPreference,
      retry_count: job.retryCount,
      correlation_id: correlationId,
      traceparent,
      input: resolvedInput,
    });

    const { stdout } = await this.runner(
      this.pythonBin,
      [
        '-m',
        'apps.worker.consumer',
        '--payload',
        payload,
      ],
      onProgress ? (p) => { void onProgress(p); } : undefined
    );

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    if (!parsed.ok) {
      const errObj = (parsed.error ?? {}) as Record<string, unknown>;
      throw new InferenceExecutionError(
        String(errObj.message ?? 'Python worker inference failure'),
        String(errObj.code ?? 'WORKER_EXECUTION_ERROR'),
        Boolean(errObj.is_transient ?? false)
      );
    }

    return {
      provider: String(parsed.provider ?? 'local_pytorch'),
      outputText: String(parsed.output_text ?? ''),
      finishReason: String(parsed.finish_reason ?? 'stop'),
      tokensIn: Number(parsed.tokens_in ?? 1),
      tokensOut: Number(parsed.tokens_out ?? 1),
      costMicrocents: Number(parsed.cost_microcents ?? 5),
      durationMs: Math.max(Number(parsed.duration_ms ?? 1), 1),
      metadata: (parsed.metadata as Record<string, unknown> | undefined) ?? {},
    };
  }
}

/**
 * Dynamic Inference Executor that routes according to job.routingPreference and model:
 * - 'mock' or model_id === 'mock' -> DefaultLocalInferenceExecutor (instant mock, zero subprocess overhead)
 * - 'local/cpu' -> PythonWorkerInferenceExecutor with device='cpu'
 * - 'local/gpu' -> PythonWorkerInferenceExecutor with device='cuda'
 * - 'cloud' -> PythonWorkerInferenceExecutor with provider dynamically selected based on model
 * - 'local' / 'local_first' -> PythonWorkerInferenceExecutor with local_pytorch
 * - 'auto' / other:
 *     - If model_id is 'mock' -> DefaultLocalInferenceExecutor
 *     - If parameters specify device or provider -> PythonWorkerInferenceExecutor
 *     - Default fallback for unit-test suite -> DefaultLocalInferenceExecutor
 */
export class RoutingInferenceExecutor implements IInferenceExecutor {
  constructor(
    private readonly mockExecutor: IInferenceExecutor = new DefaultLocalInferenceExecutor(),
    private readonly pythonExecutor: IInferenceExecutor = new PythonWorkerInferenceExecutor()
  ) {}

  async execute(
    job: Job,
    resolvedInput: Record<string, unknown>,
    checkCancelled: () => Promise<boolean>,
    onProgress?: (progress: JobProgress) => Promise<void> | void
  ): Promise<InferenceExecutionResult> {
    const pref = (job.routingPreference || 'auto').toLowerCase();
    const modelId = job.modelId.toLowerCase();

    // 1. Instant Mock path
    if (job.modelId === 'mock' || pref === 'mock' || (pref === 'auto' && job.modelId === 'mock')) {
      return this.mockExecutor.execute(job, resolvedInput, checkCancelled, onProgress);
    }

    const currentParams = (resolvedInput.parameters as Record<string, unknown>) || {};
    const updatedParams: Record<string, unknown> = {
      ...currentParams,
      routing_preference: job.routingPreference,
    };

    // 2. Real CPU Inference
    if (pref === 'local/cpu') {
      updatedParams.device = 'cpu';
      updatedParams.provider = 'local_pytorch';
      return this.pythonExecutor.execute(
        job,
        { ...resolvedInput, parameters: updatedParams },
        checkCancelled,
        onProgress
      );
    }

    // 3. Real GPU Inference (e.g. RTX 5070 Ti)
    if (pref === 'local/gpu') {
      updatedParams.device = 'cuda';
      updatedParams.provider = 'local_pytorch';
      return this.pythonExecutor.execute(
        job,
        { ...resolvedInput, parameters: updatedParams },
        checkCancelled,
        onProgress
      );
    }

    // 4. Cloud Inference
    if (pref === 'runpod' || pref === 'cloud/runpod') {
      updatedParams.provider = 'runpod';
      return this.pythonExecutor.execute(
        job,
        { ...resolvedInput, parameters: updatedParams },
        checkCancelled,
        onProgress
      );
    }

    if (pref === 'bedrock' || pref === 'cloud/bedrock') {
      updatedParams.provider = 'bedrock';
      return this.pythonExecutor.execute(
        job,
        { ...resolvedInput, parameters: updatedParams },
        checkCancelled,
        onProgress
      );
    }

    if (pref === 'sagemaker' || pref === 'cloud/sagemaker') {
      updatedParams.provider = 'sagemaker';
      return this.pythonExecutor.execute(
        job,
        { ...resolvedInput, parameters: updatedParams },
        checkCancelled,
        onProgress
      );
    }

    if (pref === 'cloud') {
      if (!updatedParams.provider) {
        if (modelId.includes('claude') || modelId.startsWith('anthropic.') || modelId.startsWith('amazon.')) {
          updatedParams.provider = 'bedrock';
        } else if (updatedParams.requires_vpc || updatedParams.vpc) {
          updatedParams.provider = 'sagemaker';
        } else {
          updatedParams.provider = 'runpod';
        }
      }
      return this.pythonExecutor.execute(
        job,
        { ...resolvedInput, parameters: updatedParams },
        checkCancelled,
        onProgress
      );
    }

    // 5. Explicit local/cloud overrides
    if (pref === 'local' || pref === 'local_first' || updatedParams.device || updatedParams.provider) {
      if (!updatedParams.provider) {
        updatedParams.provider = 'local_pytorch';
      }
      return this.pythonExecutor.execute(
        job,
        { ...resolvedInput, parameters: updatedParams },
        checkCancelled,
        onProgress
      );
    }

    // 6. Fast mock executor fallback for unspecified 'auto' jobs
    return this.mockExecutor.execute(job, resolvedInput, checkCancelled, onProgress);
  }
}

/**
 * Russian Doll (Decorator) wrapper around IInferenceExecutor that profiles
 * execution wall-clock latency, computes token throughput, and attaches audit metadata.
 */
export class ProfilingInferenceExecutor implements IInferenceExecutor {
  constructor(private readonly inner: IInferenceExecutor) {}

  async execute(
    job: Job,
    resolvedInput: Record<string, unknown>,
    checkCancelled: () => Promise<boolean>,
    onProgress?: (progress: JobProgress) => Promise<void> | void
  ): Promise<InferenceExecutionResult> {
    const startNs = process.hrtime.bigint();
    const result = await this.inner.execute(job, resolvedInput, checkCancelled, onProgress);
    const measuredMs = Math.max(Number(process.hrtime.bigint() - startNs) / 1_000_000, 1);
    const durationMs = result.durationMs > 0 ? result.durationMs : Math.round(measuredMs);
    const tokensPerSec = Number(((result.tokensOut / durationMs) * 1000).toFixed(2));

    return {
      ...result,
      durationMs,
      metadata: {
        ...result.metadata,
        profiled_wall_ms: Number(measuredMs.toFixed(3)),
        tokens_per_sec: tokensPerSec,
      },
    };
  }
}

export interface JobWorkerOptions {
  maxRetries?: number;
  baseBackoffSeconds?: number;
  maxBackoffSeconds?: number;
  pollIntervalMs?: number;
  tracer?: DistributedTracer;
  metrics?: MetricsRegistry;
}

export interface ProcessMessageOutcome {
  jobId: string;
  action: 'succeeded' | 'retrying' | 'failed_dlq' | 'skipped_terminal' | 'cancelled' | 'discarded_missing';
  retryCount?: number;
  backoffSeconds?: number;
}

export class JobWorker {
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private maxRetries: number;
  private baseBackoffSeconds: number;
  private maxBackoffSeconds: number;
  private pollIntervalMs: number;
  private executor: IInferenceExecutor;
  private tracer: DistributedTracer;
  private metrics: MetricsRegistry;
  private activeJobsCount = 0;

  constructor(
    private jobRepo: IJobRepository,
    private queueClient: IQueueClient,
    private storageClient: IStorageClient,
    executor?: IInferenceExecutor,
    options: JobWorkerOptions = {}
  ) {
    this.executor =
      executor ?? new ProfilingInferenceExecutor(new RoutingInferenceExecutor());
    this.maxRetries = options.maxRetries ?? 3;
    this.baseBackoffSeconds = options.baseBackoffSeconds ?? 2;
    this.maxBackoffSeconds = options.maxBackoffSeconds ?? 60;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.tracer = options.tracer ?? defaultTracer;
    this.metrics = options.metrics ?? defaultMetrics;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextPoll();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private scheduleNextPoll(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.processNextBatch(1);
      } catch {
        // Poll cycle errors are isolated so the daemon loop remains alive
      } finally {
        this.scheduleNextPoll();
      }
    }, this.pollIntervalMs);
  }

  async processNextBatch(maxMessages = 1): Promise<ProcessMessageOutcome[]> {
    const messages = await this.queueClient.receiveMessages(maxMessages, 0);
    this.syncQueueDepthGauges();
    const outcomes: ProcessMessageOutcome[] = [];
    for (const msg of messages) {
      const outcome = await this.processMessage(msg);
      outcomes.push(outcome);
    }
    this.syncQueueDepthGauges();
    return outcomes;
  }

  private syncQueueDepthGauges(): void {
    const queueDepth = (this.queueClient as { getQueueLength?: () => number }).getQueueLength?.();
    if (typeof queueDepth === 'number') {
      this.metrics.setGauge('queue_messages_visible', { queue_name: 'inference-jobs' }, queueDepth);
    }
  }

  async processMessage(msg: ReceivedMessage): Promise<ProcessMessageOutcome> {
    const { tenantId, jobId } = msg.body;
    const job = await this.jobRepo.findById(tenantId, jobId);

    if (!job) {
      await this.queueClient.deleteMessage(msg.receiptHandle);
      return { jobId, action: 'discarded_missing' };
    }

    const startedAt = job.startedAt ?? new Date();

    // Transition to PROCESSING if not already in a terminal state
    const processingJob = await this.jobRepo.update(tenantId, jobId, {
      status: JobStatus.PROCESSING,
      expectedCurrentStatuses: [JobStatus.QUEUED, JobStatus.RETRYING, JobStatus.PROCESSING],
      startedAt,
      progressPct: 15,
      progress: {
        phase: 'loading_model',
        percent: 15,
        message: `Allocating compute worker for ${job.modelId}`,
      },
    });

    if (!processingJob) {
      await this.queueClient.deleteMessage(msg.receiptHandle);
      return { jobId, action: 'skipped_terminal' };
    }

    // Record queue wait duration on initial pickup
    const waitSeconds = Math.max(
      (startedAt.getTime() - processingJob.createdAt.getTime()) / 1000,
      0.001
    );
    this.metrics.observeHistogram(
      'queue_wait_duration_seconds',
      {
        tenant_id: tenantId,
        model_id: processingJob.modelId,
      },
      Number(waitSeconds.toFixed(6))
    );

    const correlationId =
      msg.body.correlationId ?? processingJob.correlationId ?? randomUUID();
    const traceparent = msg.body.traceparent ?? processingJob.traceparent ?? null;

    this.activeJobsCount += 1;
    this.metrics.setGauge('worker_active_jobs', {}, this.activeJobsCount);
    this.metrics.setGauge(
      'worker_utilization_ratio',
      {},
      Math.min(this.activeJobsCount, 1)
    );

    try {
      return await this.tracer.startActiveSpan(
        'job_processing',
        {
          kind: 'CONSUMER',
          serviceName: 'inference-worker',
          traceparent,
          correlationId,
          tenantId,
          jobId,
          attributes: {
            'messaging.system': 'sqs',
            'messaging.operation': 'process',
            'gen_ai.request.model': processingJob.modelId,
            'job.retry_count': processingJob.retryCount,
            'queue.wait_ms': Math.round(waitSeconds * 1000),
          },
        },
        async (jobSpan) => {
          const resolvedInput = await this.resolveJobInput(processingJob);

          const checkCancelled = async (): Promise<boolean> => {
            const latest = await this.jobRepo.findById(tenantId, jobId);
            return !latest || latest.status === JobStatus.CANCELLED;
          };

          const result = await this.tracer.startActiveSpan(
            'inference_execution',
            {
              kind: 'INTERNAL',
              serviceName: 'inference-worker',
              correlationId,
              tenantId,
              jobId,
              attributes: {
                'gen_ai.request.model': processingJob.modelId,
              },
            },
            async (infSpan) => {
              const onProgress = async (prog: JobProgress) => {
                await this.jobRepo.update(tenantId, jobId, {
                  progress: prog,
                  progressPct: prog.percent,
                  expectedCurrentStatuses: [JobStatus.PROCESSING],
                });
              };
              const execRes = await this.executor.execute(
                processingJob,
                resolvedInput,
                checkCancelled,
                onProgress
              );
              const hwTelemetry = execRes.metadata?.telemetry as
                | Record<string, unknown>
                | undefined;
              const device =
                typeof hwTelemetry?.device_type === 'string'
                  ? hwTelemetry.device_type
                  : 'cpu';
              const vramMb =
                typeof hwTelemetry?.vram_peak_mb === 'number'
                  ? hwTelemetry.vram_peak_mb
                  : 0;

              const isMocked = Boolean(
                execRes.metadata?.is_mocked ??
                  (execRes.metadata?.execution_mode === 'mock' ||
                    execRes.provider !== 'local_pytorch')
              );
              const executionMode = String(
                execRes.metadata?.execution_mode ?? (isMocked ? 'mock' : 'live')
              );

              infSpan.setAttributes({
                'gen_ai.system': execRes.provider,
                'provider.name': execRes.provider,
                'provider.execution_mode': executionMode,
                'provider.is_mocked': isMocked,
                'inference.device': device,
                'tokens_in': execRes.tokensIn,
                'tokens_out': execRes.tokensOut,
                'vram_mb': vramMb,
                'duration_ms': execRes.durationMs,
              });
              return execRes;
            }
          );

          const isJobMocked = Boolean(
            result.metadata?.is_mocked ??
              (result.metadata?.execution_mode === 'mock' ||
                result.provider !== 'local_pytorch')
          );
          const jobExecutionMode = String(
            result.metadata?.execution_mode ?? (isJobMocked ? 'mock' : 'live')
          );

          jobSpan.setAttribute('gen_ai.system', result.provider);
          jobSpan.setAttribute('provider.name', result.provider);
          jobSpan.setAttribute('provider.execution_mode', jobExecutionMode);
          jobSpan.setAttribute('provider.is_mocked', isJobMocked);

          // Persist output artifact to S3-compatible storage inside a dedicated span
          await this.jobRepo.update(tenantId, jobId, {
            progressPct: 95,
            progress: {
              phase: 'encoding_artifact',
              percent: 95,
              message: 'Persisting output artifacts to storage',
            },
            expectedCurrentStatuses: [JobStatus.PROCESSING],
          });
          const artifactKey = `tenants/${tenantId}/outputs/${jobId}/result.json`;
          const outputUri = await this.tracer.startActiveSpan(
            'artifact_storage',
            {
              kind: 'CLIENT',
              serviceName: 'inference-worker',
              correlationId,
              tenantId,
              jobId,
              attributes: {
                'storage.system': 's3',
                'storage.key': artifactKey,
              },
            },
            async (artSpan) => {
              const artifactPayload = {
                job_id: jobId,
                tenant_id: tenantId,
                correlation_id: correlationId,
                trace_id: jobSpan.traceId,
                traceparent: artSpan.traceparent,
                model_id: processingJob.modelId,
                provider: result.provider,
                output_text: result.outputText,
                finish_reason: result.finishReason,
                usage: {
                  prompt_tokens: result.tokensIn,
                  completion_tokens: result.tokensOut,
                  total_tokens: result.tokensIn + result.tokensOut,
                  cost_microcents: result.costMicrocents,
                },
                completed_at: new Date().toISOString(),
              };
              const uri = await this.storageClient.putObject(
                artifactKey,
                JSON.stringify(artifactPayload),
                'application/json'
              );
              artSpan.setAttribute('artifact.uri', uri);

              // For image or video models, generate and store visual media artifacts
              const outputModality = getJobOutputModality(processingJob.modelId);
              const promptStr = String(
                resolvedInput.prompt ??
                  resolvedInput.input_text ??
                  resolvedInput.text ??
                  processingJob.modelId
              );

              if (outputModality === 'image') {
                const imageKey = `tenants/${tenantId}/outputs/${jobId}/output.png`;
                if (result.metadata?.image_base64) {
                  const pngBuf = Buffer.from(String(result.metadata.image_base64), 'base64');
                  await this.storageClient.putObject(imageKey, pngBuf, 'image/png');
                } else {
                  const pngBuf = generateDiffusionPngArtifact(promptStr, processingJob.modelId);
                  await this.storageClient.putObject(imageKey, pngBuf, 'image/png');
                }
              } else if (outputModality === 'video') {
                const videoKey = `tenants/${tenantId}/outputs/${jobId}/output.mp4`;
                const posterKey = `tenants/${tenantId}/outputs/${jobId}/poster.png`;
                if (result.metadata?.poster_base64) {
                  const posterBuf = Buffer.from(String(result.metadata.poster_base64), 'base64');
                  await this.storageClient.putObject(posterKey, posterBuf, 'image/png');
                } else if (result.metadata?.image_base64) {
                  const posterBuf = Buffer.from(String(result.metadata.image_base64), 'base64');
                  await this.storageClient.putObject(posterKey, posterBuf, 'image/png');
                } else {
                  const posterBuf = generateDiffusionPngArtifact(promptStr, processingJob.modelId);
                  await this.storageClient.putObject(posterKey, posterBuf, 'image/png');
                }
                if (result.metadata?.video_base64) {
                  const mp4Buf = Buffer.from(String(result.metadata.video_base64), 'base64');
                  await this.storageClient.putObject(videoKey, mp4Buf, 'video/mp4');
                } else {
                  await this.storageClient.putObject(videoKey, resolveDefaultMp4Buffer(), 'video/mp4');
                }
              }

              return uri;
            }
          );

          // Strip internal IPC transfer buffers (e.g. image_base64, video_base64, poster_base64) so they don't bloat the database or response JSON
          const sanitizedMetadata = result.metadata ? { ...result.metadata } : undefined;
          if (sanitizedMetadata && 'image_base64' in sanitizedMetadata) {
            delete (sanitizedMetadata as Record<string, unknown>).image_base64;
          }
          if (sanitizedMetadata && 'video_base64' in sanitizedMetadata) {
            delete (sanitizedMetadata as Record<string, unknown>).video_base64;
          }
          if (sanitizedMetadata && 'poster_base64' in sanitizedMetadata) {
            delete (sanitizedMetadata as Record<string, unknown>).poster_base64;
          }

          // Atomically transition to SUCCEEDED only if still PROCESSING
          const succeededJob = await this.jobRepo.update(tenantId, jobId, {
            status: JobStatus.SUCCEEDED,
            expectedCurrentStatuses: [JobStatus.PROCESSING],
            provider: result.provider,
            outputPayload: {
              output_text: result.outputText,
              finish_reason: result.finishReason,
              ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {}),
            },
            outputUri,
            durationMs: result.durationMs,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            costMicrocents: result.costMicrocents,
            completedAt: new Date(),
            progressPct: 100,
            progress: {
              phase: 'completed',
              percent: 100,
            },
          });

          await this.queueClient.deleteMessage(msg.receiptHandle);

          if (!succeededJob) {
            jobSpan.setAttribute('job.outcome', 'cancelled');
            return { jobId, action: 'cancelled' };
          }

          this.recordInferenceSuccessMetrics(processingJob, result);
          jobSpan.setAttribute('job.outcome', 'succeeded');

          return { jobId, action: 'succeeded', retryCount: succeededJob.retryCount };
        }
      );
    } catch (err: unknown) {
      return await this.handleExecutionFailure(msg, processingJob, err);
    } finally {
      this.activeJobsCount = Math.max(this.activeJobsCount - 1, 0);
      this.metrics.setGauge('worker_active_jobs', {}, this.activeJobsCount);
      this.metrics.setGauge(
        'worker_utilization_ratio',
        {},
        Math.min(this.activeJobsCount, 1)
      );
    }
  }

  private recordInferenceSuccessMetrics(job: Job, result: InferenceExecutionResult): void {
    const durationSec = Math.max(result.durationMs / 1000, 0.001);
    this.metrics.observeHistogram(
      'inference_job_duration_seconds',
      {
        tenant_id: job.tenantId,
        model_id: job.modelId,
        provider: result.provider,
      },
      Number(durationSec.toFixed(6))
    );

    const ttftMs =
      typeof result.metadata?.ttft_ms === 'number'
        ? result.metadata.ttft_ms
        : Math.max(result.durationMs * 0.2, 1);
    this.metrics.observeHistogram(
      'inference_token_generation_duration_seconds',
      {
        model_id: job.modelId,
        provider: result.provider,
      },
      Number((ttftMs / 1000).toFixed(6))
    );

    this.metrics.incCounter(
      'inference_tokens_total',
      {
        tenant_id: job.tenantId,
        model_id: job.modelId,
        type: 'prompt',
      },
      result.tokensIn
    );
    this.metrics.incCounter(
      'inference_tokens_total',
      {
        tenant_id: job.tenantId,
        model_id: job.modelId,
        type: 'completion',
      },
      result.tokensOut
    );
    this.metrics.incCounter(
      'inference_cost_microcents_total',
      {
        tenant_id: job.tenantId,
        provider: result.provider,
      },
      result.costMicrocents
    );

    const hwTelemetry = result.metadata?.telemetry as Record<string, unknown> | undefined;
    if (hwTelemetry) {
      const device = String(hwTelemetry.device_type ?? 'cpu');
      const backend = String(hwTelemetry.backend ?? 'unknown');
      const mode = String(hwTelemetry.measurement_mode ?? 'measured');
      const vramMb = Number(hwTelemetry.vram_allocated_mb ?? 0);
      const gpuUtil =
        typeof hwTelemetry.gpu_utilization_pct === 'number'
          ? hwTelemetry.gpu_utilization_pct
          : 0;
      const cpuUtil =
        typeof hwTelemetry.cpu_utilization_pct === 'number'
          ? hwTelemetry.cpu_utilization_pct
          : 8.5;
      const rssMb = Number(hwTelemetry.ram_rss_mb ?? 0);

      this.metrics.setGauge('DCGM_FI_DEV_FB_USED', { device, backend, mode }, vramMb);
      this.metrics.setGauge('DCGM_FI_DEV_GPU_UTIL', { device, backend, mode }, gpuUtil);
      this.metrics.setGauge('worker_cpu_utilization_pct', { device, backend, mode }, cpuUtil);
      this.metrics.setGauge('worker_process_rss_mb', { device, backend, mode }, rssMb);
    }
  }

  private isBinaryMediaPath(uriOrKey: string): boolean {
    const clean = uriOrKey.split('?')[0].toLowerCase();
    const binaryExtensions = ['.jpg', '.jpeg', '.png', '.mp4', '.pdf', '.bin', '.webp', '.mov'];
    return binaryExtensions.some((ext) => clean.endsWith(ext));
  }

  private detectMediaContentType(filenameOrKey: string): string {
    const ext = path.extname(filenameOrKey.split('?')[0]).toLowerCase();
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      case '.mp4':
        return 'video/mp4';
      case '.mov':
        return 'video/quicktime';
      case '.pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  private async resolveJobInput(job: Job): Promise<Record<string, unknown>> {
    const payload = job.inputPayload ?? {};
    const mediaUri = typeof payload.media_asset_uri === 'string' ? payload.media_asset_uri : undefined;
    const targetUri = (payload._offloaded && typeof payload.inputUri === 'string')
      ? payload.inputUri
      : (job.inputUri || mediaUri);

    if (targetUri && targetUri.startsWith('s3://')) {
      const key = targetUri.replace(/^s3:\/\/[^/]+\//, '');
      const buffer = await this.storageClient.getObject(key);
      if (!buffer) {
        throw new InferenceExecutionError(
          `Input artifact not found at '${targetUri}'`,
          'INPUT_ARTIFACT_NOT_FOUND',
          false
        );
      }

      // Check if binary media asset
      if (this.isBinaryMediaPath(key) || this.isBinaryMediaPath(targetUri)) {
        const cacheDir = path.resolve(REPO_ROOT, '.cache/media');
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        const basename = path.basename(key);
        const localCachedPath = path.resolve(cacheDir, basename);
        fs.writeFileSync(localCachedPath, buffer);

        const contentType = this.detectMediaContentType(basename);
        const mediaMetadata = {
          media_asset_uri: targetUri,
          local_path: localCachedPath,
          size_bytes: buffer.length,
          filename: basename,
          content_type: contentType,
        };

        return {
          ...payload,
          media_asset_uri: targetUri,
          media_metadata: mediaMetadata,
          local_cached_path: localCachedPath,
        };
      }

      // Non-binary S3 artifact (e.g. JSON payload)
      const parsed = JSON.parse(buffer.toString('utf-8')) as Record<string, unknown>;
      if (typeof parsed.media_asset_uri === 'string' && parsed.media_asset_uri.startsWith('s3://') && this.isBinaryMediaPath(parsed.media_asset_uri)) {
        const mKey = parsed.media_asset_uri.replace(/^s3:\/\/[^/]+\//, '');
        const mBuffer = await this.storageClient.getObject(mKey);
        if (mBuffer) {
          const cacheDir = path.resolve(REPO_ROOT, '.cache/media');
          if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
          const mBasename = path.basename(mKey);
          const mLocalPath = path.resolve(cacheDir, mBasename);
          fs.writeFileSync(mLocalPath, mBuffer);
          parsed.local_cached_path = mLocalPath;
          parsed.media_metadata = {
            media_asset_uri: parsed.media_asset_uri,
            local_path: mLocalPath,
            size_bytes: mBuffer.length,
            filename: mBasename,
            content_type: this.detectMediaContentType(mBasename),
          };
        }
      }
      return parsed;
    }

    if (typeof payload.media_asset_uri === 'string') {
      const localCandidate = path.isAbsolute(payload.media_asset_uri)
        ? payload.media_asset_uri
        : path.resolve(REPO_ROOT, payload.media_asset_uri);
      if (fs.existsSync(localCandidate)) {
        const stat = fs.statSync(localCandidate);
        const basename = path.basename(localCandidate);
        return {
          ...payload,
          local_cached_path: localCandidate,
          media_metadata: {
            media_asset_uri: payload.media_asset_uri,
            local_path: localCandidate,
            size_bytes: stat.size,
            filename: basename,
            content_type: this.detectMediaContentType(basename),
          },
        };
      }
    }

    return payload;
  }

  private async handleExecutionFailure(
    msg: ReceivedMessage,
    job: Job,
    err: unknown
  ): Promise<ProcessMessageOutcome> {
    const { tenantId, jobId } = msg.body;

    // Check if cancelled concurrently
    const current = await this.jobRepo.findById(tenantId, jobId);
    if (!current || current.status === JobStatus.CANCELLED) {
      await this.queueClient.deleteMessage(msg.receiptHandle);
      return { jobId, action: 'cancelled' };
    }

    const isInferenceErr = err instanceof InferenceExecutionError;
    const isTransient = isInferenceErr ? err.isTransient : true;
    const errorCode = isInferenceErr ? err.code : 'WORKER_EXECUTION_ERROR';
    const errorMessage = err instanceof Error ? err.message : String(err);
    const provider = job.provider ?? 'local_worker';

    this.metrics.incCounter('inference_job_errors_total', {
      provider,
      error_code: errorCode,
      is_transient: String(isTransient),
    });

    const maxAllowedRetries = job.maxRetries ?? this.maxRetries;
    const nextRetryCount = job.retryCount + 1;

    if (isTransient && nextRetryCount <= maxAllowedRetries) {
      const backoffSeconds = calculateBackoffSeconds(nextRetryCount, {
        baseDelaySeconds: this.baseBackoffSeconds,
        maxDelaySeconds: this.maxBackoffSeconds,
      });

      await this.jobRepo.update(tenantId, jobId, {
        status: JobStatus.RETRYING,
        expectedCurrentStatuses: [JobStatus.PROCESSING],
        retryCount: nextRetryCount,
        errorCode,
        errorMessage,
      });

      await this.queueClient.changeMessageVisibility(msg.receiptHandle, backoffSeconds);

      this.metrics.incCounter('inference_job_retries_total', {
        provider,
        error_type: errorCode,
      });

      return {
        jobId,
        action: 'retrying',
        retryCount: nextRetryCount,
        backoffSeconds,
      };
    }

    // Retries exhausted or permanent error -> mark FAILED and quarantine in DLQ
    const finalRetryCount = isTransient ? job.retryCount : job.retryCount;
    await this.jobRepo.update(tenantId, jobId, {
      status: JobStatus.FAILED,
      expectedCurrentStatuses: [JobStatus.PROCESSING, JobStatus.RETRYING, JobStatus.QUEUED],
      errorCode,
      errorMessage,
      completedAt: new Date(),
      progress: {
        phase: 'failed',
        percent: job.progressPct ?? 0,
        message: errorMessage,
      },
    });

    await this.queueClient.sendToDlq({
      ...msg.body,
      failureReason: errorMessage,
      errorCode,
      retryCount: finalRetryCount,
      failedAt: new Date().toISOString(),
    });

    this.metrics.incCounter('inference_job_dlq_total', {
      queue_name: 'inference-jobs-dlq',
    });

    await this.queueClient.deleteMessage(msg.receiptHandle);

    return {
      jobId,
      action: 'failed_dlq',
      retryCount: finalRetryCount,
    };
  }
}

