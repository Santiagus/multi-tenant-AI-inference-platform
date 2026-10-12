export const JobStatus = {
  SUBMITTED: 'SUBMITTED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  RETRYING: 'RETRYING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type JobStatusType = (typeof JobStatus)[keyof typeof JobStatus];

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatusType> = new Set([
  JobStatus.SUCCEEDED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
]);

export function isTerminalStatus(status: JobStatusType): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

const VALID_TRANSITIONS: Record<JobStatusType, ReadonlySet<JobStatusType>> = {
  [JobStatus.SUBMITTED]: new Set([JobStatus.QUEUED, JobStatus.CANCELLED]),
  [JobStatus.QUEUED]: new Set([
    JobStatus.PROCESSING,
    JobStatus.SUCCEEDED,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
  ]),
  [JobStatus.PROCESSING]: new Set([
    JobStatus.RETRYING,
    JobStatus.QUEUED,
    JobStatus.SUCCEEDED,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
  ]),
  [JobStatus.RETRYING]: new Set([
    JobStatus.QUEUED,
    JobStatus.PROCESSING,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
  ]),
  [JobStatus.SUCCEEDED]: new Set(),
  [JobStatus.FAILED]: new Set(),
  [JobStatus.CANCELLED]: new Set(),
};

export function canTransitionStatus(from: JobStatusType, to: JobStatusType): boolean {
  if (from === to) {
    return !isTerminalStatus(from);
  }
  return VALID_TRANSITIONS[from].has(to);
}

export interface BackoffOptions {
  baseDelaySeconds?: number;
  maxDelaySeconds?: number;
}

/**
 * Calculates bounded exponential backoff in seconds: min(baseDelay * 2^(retryCount - 1), maxDelay).
 */
export function calculateBackoffSeconds(
  retryCount: number,
  options: BackoffOptions = {}
): number {
  const base = Math.max(options.baseDelaySeconds ?? 2, 0);
  const max = Math.max(options.maxDelaySeconds ?? 60, base);
  const attempt = Math.max(retryCount, 1);
  const rawDelay = base * Math.pow(2, attempt - 1);
  return Math.min(rawDelay, max);
}

export const RoutingPreference = {
  AUTO: 'auto',
  LOCAL: 'local',
  CLOUD: 'cloud',
  COST_OPTIMIZED: 'cost_optimized',
  LOW_LATENCY: 'low_latency',
} as const;

export type RoutingPreferenceType = (typeof RoutingPreference)[keyof typeof RoutingPreference];

export interface JobUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicrocents: number;
}

export interface JobArtifact {
  name: string;
  downloadUrl: string;
}

export interface JobResult {
  outputText?: string;
  finishReason?: string;
  metadata?: Record<string, unknown>;
}

export interface Job {
  id: string;
  tenantId: string;
  idempotencyKey: string | null;
  requestHash?: string | null;
  correlationId?: string | null;
  traceparent?: string | null;
  modelId: string;
  routingPreference: RoutingPreferenceType;
  priority: number;
  status: JobStatusType;
  inputPayload: Record<string, unknown> | null;
  inputUri: string | null;
  outputPayload: Record<string, unknown> | null;
  outputUri: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  provider: string | null;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costMicrocents: number | null;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface NewJobInput {
  tenantId: string;
  modelId: string;
  routingPreference?: RoutingPreferenceType;
  priority?: number;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  correlationId?: string | null;
  traceparent?: string | null;
  inputPayload?: Record<string, unknown> | null;
  inputUri?: string | null;
  maxRetries?: number;
}


