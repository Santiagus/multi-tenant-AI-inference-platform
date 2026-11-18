import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelModelCacheEnsure,
  getModelDownloadStatus,
  listModelDownloadStatuses,
  startModelCacheEnsure,
} from '../../src/application/model-cache.js';

describe('model cache download state', () => {
  test('returns idle status for unknown models', () => {
    const status = getModelDownloadStatus('org/never-seen');
    assert.equal(status.status, 'idle');
    assert.equal(status.model_id, 'org/never-seen');
  });

  test('startModelCacheEnsure rejects empty model id', () => {
    assert.throws(() => startModelCacheEnsure('  '), /model_id is required/);
  });

  test('cancelModelCacheEnsure rejects empty model id', () => {
    assert.throws(() => cancelModelCacheEnsure('  '), /model_id is required/);
  });

  test('cancelModelCacheEnsure marks status cancelled when no process is active', () => {
    const status = cancelModelCacheEnsure('org/cancel-orphan');
    assert.equal(status.status, 'cancelled');
    assert.match(status.message, /cancelled/i);
  });

  test('listModelDownloadStatuses returns an array', () => {
    assert.ok(Array.isArray(listModelDownloadStatuses()));
  });
});
