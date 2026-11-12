import type { JobStatus } from '../../types';

/**
 * Lifecycle status descriptions (job-lifecycle-contract.md State Definitions).
 * Used as StatusBadge tooltips / accessible descriptions.
 */
export const JOB_STATUS_DESCRIPTIONS: Record<JobStatus, string> = {
  SUBMITTED: 'Received and validated by the control plane; written to PostgreSQL.',
  QUEUED: 'Job envelope published to the message broker; awaiting worker pickup.',
  PROCESSING: 'Worker leased the job; heartbeat active and inference executing.',
  RETRYING: 'Transient provider error; delayed backoff before re-queueing.',
  SUCCEEDED: 'Execution completed; results and artifacts persisted.',
  FAILED: 'Permanent execution failure, invalid parameters, or exhausted retries.',
  CANCELLED: 'Explicitly terminated by client request before or during execution.',
};

export function getJobStatusDescription(status: string): string | undefined {
  const key = status.toUpperCase() as JobStatus;
  return JOB_STATUS_DESCRIPTIONS[key];
}
