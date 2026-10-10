export const JobStatus = {
  SUBMITTED: 'SUBMITTED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type JobStatusType = (typeof JobStatus)[keyof typeof JobStatus];

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
  inputPayload?: Record<string, unknown> | null;
  inputUri?: string | null;
}

