import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config/env.js';

describe('Config Management', () => {
  test('loads valid default configurations', () => {
    const config = loadConfig({});
    assert.equal(config.PORT, 3000);
    assert.equal(config.HOST, '0.0.0.0');
    assert.equal(config.DATABASE_URL, 'postgresql://postgres:postgres@localhost:5432/platform');
    assert.equal(config.S3_BUCKET, 'platform-artifacts');
    assert.equal(config.DEFAULT_TENANT_ID, 'tenant-default');
  });

  test('applies custom configuration overrides', () => {
    const config = loadConfig({
      PORT: '8080',
      DATABASE_URL: 'postgresql://test:test@localhost:5433/test_db',
      S3_BUCKET: 'custom-bucket',
      NODE_ENV: 'test',
    });
    assert.equal(config.PORT, 8080);
    assert.equal(config.DATABASE_URL, 'postgresql://test:test@localhost:5433/test_db');
    assert.equal(config.S3_BUCKET, 'custom-bucket');
    assert.equal(config.NODE_ENV, 'test');
  });

  test('fails validation when invalid port is provided', () => {
    assert.throws(() => {
      loadConfig({ PORT: '-10' });
    });
  });
});

