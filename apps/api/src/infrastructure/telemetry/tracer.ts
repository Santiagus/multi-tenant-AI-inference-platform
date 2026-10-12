import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';

export type SpanKind = 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';
export type SpanStatus = 'OK' | 'ERROR';

export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: SpanKind;
  serviceName: string;
  startTimeIso: string;
  endTimeIso: string;
  durationMs: number;
  status: SpanStatus;
  errorMessage?: string;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface TelemetryContext {
  correlationId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  traceFlags: string;
  tenantId?: string;
  jobId?: string;
}

const W3C_TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

export interface ParsedTraceparent {
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
}

export function parseTraceparent(header?: string | null): ParsedTraceparent | null {
  if (!header || typeof header !== 'string') {
    return null;
  }
  const trimmed = header.trim().toLowerCase();
  const match = W3C_TRACEPARENT_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }
  const traceId = match[1];
  const parentSpanId = match[2];
  const traceFlags = match[3];
  // W3C specification forbids all-zero traceId or spanId
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) {
    return null;
  }
  return { traceId, parentSpanId, traceFlags };
}

export function formatTraceparent(
  traceId: string,
  spanId: string,
  traceFlags = '01'
): string {
  return `00-${traceId.toLowerCase()}-${spanId.toLowerCase()}-${traceFlags.toLowerCase()}`;
}

const telemetryStorage = new AsyncLocalStorage<TelemetryContext>();

export function getTelemetryContext(): TelemetryContext | undefined {
  return telemetryStorage.getStore();
}

export function runWithTelemetryContext<T>(
  context: Partial<TelemetryContext> & { traceparent?: string | null },
  fn: () => T
): T {
  const current = telemetryStorage.getStore();
  const parsed = parseTraceparent(context.traceparent);

  const traceId =
    context.traceId ?? parsed?.traceId ?? current?.traceId ?? generateTraceId();
  const parentSpanId =
    context.parentSpanId !== undefined
      ? context.parentSpanId
      : (parsed?.parentSpanId ?? current?.spanId ?? null);
  const spanId = context.spanId ?? generateSpanId();
  const traceFlags = context.traceFlags ?? parsed?.traceFlags ?? current?.traceFlags ?? '01';
  const correlationId =
    context.correlationId ?? current?.correlationId ?? randomUUID();

  const nextContext: TelemetryContext = {
    correlationId,
    traceId,
    spanId,
    parentSpanId,
    traceFlags,
    tenantId: context.tenantId ?? current?.tenantId,
    jobId: context.jobId ?? current?.jobId,
  };

  return telemetryStorage.run(nextContext, fn);
}

export interface ActiveSpanHandle {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly traceparent: string;
  setAttribute(key: string, value: string | number | boolean | undefined | null): void;
  setAttributes(attrs: Record<string, string | number | boolean | undefined | null>): void;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
}

export class DistributedTracer {
  private spans: SpanRecord[] = [];
  private readonly maxSpans: number;
  private readonly serviceName: string;

  constructor(options: { serviceName?: string; maxSpans?: number } = {}) {
    this.serviceName = options.serviceName ?? 'control-plane-api';
    this.maxSpans = options.maxSpans ?? 5000;
  }

  async startActiveSpan<T>(
    name: string,
    options: {
      kind?: SpanKind;
      serviceName?: string;
      traceparent?: string | null;
      correlationId?: string | null;
      tenantId?: string;
      jobId?: string;
      attributes?: Record<string, string | number | boolean | undefined | null>;
    },
    fn: (span: ActiveSpanHandle) => Promise<T>
  ): Promise<T> {
    const current = getTelemetryContext();
    const parsed = parseTraceparent(options.traceparent);

    const traceId = parsed?.traceId ?? current?.traceId ?? generateTraceId();
    const parentSpanId = parsed?.parentSpanId ?? current?.spanId ?? null;
    const spanId = generateSpanId();
    const traceFlags = parsed?.traceFlags ?? current?.traceFlags ?? '01';
    const correlationId =
      options.correlationId ?? current?.correlationId ?? randomUUID();
    const tenantId = options.tenantId ?? current?.tenantId;
    const jobId = options.jobId ?? current?.jobId;

    const attributes: Record<string, string | number | boolean> = {
      'correlation.id': correlationId,
    };
    if (tenantId) {
      attributes['tenant.id'] = tenantId;
    }
    if (jobId) {
      attributes['job.id'] = jobId;
    }

    if (options.attributes) {
      for (const [k, v] of Object.entries(options.attributes)) {
        if (v !== undefined && v !== null) {
          attributes[k] = v;
        }
      }
    }

    const events: SpanEvent[] = [];
    const startTimeIso = new Date().toISOString();
    const startNs = process.hrtime.bigint();

    const handle: ActiveSpanHandle = {
      traceId,
      spanId,
      parentSpanId,
      traceparent: formatTraceparent(traceId, spanId, traceFlags),
      setAttribute: (key, value) => {
        if (value !== undefined && value !== null) {
          attributes[key] = value;
        }
      },
      setAttributes: (attrs) => {
        for (const [k, v] of Object.entries(attrs)) {
          if (v !== undefined && v !== null) {
            attributes[k] = v;
          }
        }
      },
      addEvent: (eventName, eventAttrs) => {
        events.push({
          name: eventName,
          timestamp: new Date().toISOString(),
          attributes: eventAttrs,
        });
      },
    };

    const spanContext: TelemetryContext = {
      correlationId,
      traceId,
      spanId,
      parentSpanId,
      traceFlags,
      tenantId: typeof attributes['tenant.id'] === 'string' ? (attributes['tenant.id'] as string) : tenantId,
      jobId: typeof attributes['job.id'] === 'string' ? (attributes['job.id'] as string) : jobId,
    };

    try {
      const result = await telemetryStorage.run(spanContext, () => fn(handle));
      this.finishSpan(
        name,
        options.kind ?? 'INTERNAL',
        options.serviceName ?? this.serviceName,
        traceId,
        spanId,
        parentSpanId,
        startTimeIso,
        startNs,
        'OK',
        undefined,
        attributes,
        events
      );
      return result;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.finishSpan(
        name,
        options.kind ?? 'INTERNAL',
        options.serviceName ?? this.serviceName,
        traceId,
        spanId,
        parentSpanId,
        startTimeIso,
        startNs,
        'ERROR',
        errMsg,
        attributes,
        events
      );
      throw err;
    }
  }

  recordExternalSpan(span: SpanRecord): void {
    this.spans.push(span);
    if (this.spans.length > this.maxSpans) {
      this.spans.shift();
    }
  }

  private finishSpan(
    name: string,
    kind: SpanKind,
    serviceName: string,
    traceId: string,
    spanId: string,
    parentSpanId: string | null,
    startTimeIso: string,
    startNs: bigint,
    status: SpanStatus,
    errorMessage: string | undefined,
    attributes: Record<string, string | number | boolean>,
    events: SpanEvent[]
  ): void {
    const durationMs = Number(
      (Number(process.hrtime.bigint() - startNs) / 1_000_000).toFixed(3)
    );
    const record: SpanRecord = {
      traceId,
      spanId,
      parentSpanId,
      name,
      kind,
      serviceName,
      startTimeIso,
      endTimeIso: new Date().toISOString(),
      durationMs: Math.max(durationMs, 0.001),
      status,
      ...(errorMessage ? { errorMessage } : {}),
      attributes: { ...attributes },
      events: [...events],
    };
    this.recordExternalSpan(record);
  }

  getSpansByJobId(jobId: string, tenantId?: string): SpanRecord[] {
    return this.spans
      .filter(
        (s) =>
          s.attributes['job.id'] === jobId &&
          (!tenantId || !s.attributes['tenant.id'] || s.attributes['tenant.id'] === tenantId)
      )
      .sort((a, b) => a.startTimeIso.localeCompare(b.startTimeIso));
  }

  getSpansByCorrelationId(correlationId: string, tenantId?: string): SpanRecord[] {
    return this.spans
      .filter(
        (s) =>
          s.attributes['correlation.id'] === correlationId &&
          (!tenantId || !s.attributes['tenant.id'] || s.attributes['tenant.id'] === tenantId)
      )
      .sort((a, b) => a.startTimeIso.localeCompare(b.startTimeIso));
  }

  getSpansByTraceId(traceId: string, tenantId?: string): SpanRecord[] {
    return this.spans
      .filter(
        (s) =>
          s.traceId === traceId &&
          (!tenantId || !s.attributes['tenant.id'] || s.attributes['tenant.id'] === tenantId)
      )
      .sort((a, b) => a.startTimeIso.localeCompare(b.startTimeIso));
  }

  getAllSpans(): SpanRecord[] {
    return [...this.spans];
  }

  clear(): void {
    this.spans = [];
  }
}

export const defaultTracer = new DistributedTracer();

