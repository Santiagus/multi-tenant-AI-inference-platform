import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_STATUS_DESCRIPTIONS,
  getJobStatusDescription,
} from '../src/components/common/statusDescriptions.ts';

describe('Job status tooltips', () => {
  it('provides a lifecycle description for every job status', () => {
    const statuses = [
      'SUBMITTED',
      'QUEUED',
      'PROCESSING',
      'RETRYING',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
    ] as const;

    for (const status of statuses) {
      const description = getJobStatusDescription(status);
      assert.ok(description && description.length > 10, `missing description for ${status}`);
      assert.equal(JOB_STATUS_DESCRIPTIONS[status], description);
    }
  });

  it('returns undefined for non-job badge statuses', () => {
    assert.equal(getJobStatusDescription('HEALTHY'), undefined);
    assert.equal(getJobStatusDescription('unknown'), undefined);
  });
});
