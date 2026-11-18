import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';

describe('Storage Abstraction', () => {
  test('puts and gets objects in storage', async () => {
    const storage = new InMemoryStorageClient();
    const uri = await storage.putObject('test-key.txt', 'hello world', 'text/plain');

    assert.equal(uri, 's3://mock-bucket/test-key.txt');

    const retrieved = await storage.getObject('test-key.txt');
    assert.ok(retrieved);
    assert.equal(retrieved.toString('utf-8'), 'hello world');
  });

  test('returns null for non-existent objects', async () => {
    const storage = new InMemoryStorageClient();
    const retrieved = await storage.getObject('does-not-exist.txt');
    assert.equal(retrieved, null);
  });

  test('generates valid presigned upload and download URLs', async () => {
    const storage = new InMemoryStorageClient();
    const uploadUrl = await storage.getPresignedUploadUrl('upload.json', 300);
    const downloadUrl = await storage.getPresignedDownloadUrl('download.json', 300);

    assert.ok(uploadUrl.includes('/upload/'));
    assert.ok(downloadUrl.includes('/download/'));
  });

  test('reflects health status correctly', async () => {
    const storage = new InMemoryStorageClient();
    assert.equal(await storage.isHealthy(), true);

    storage.setHealthy(false);
    assert.equal(await storage.isHealthy(), false);
  });

  test('lists and deletes keys by prefix', async () => {
    const storage = new InMemoryStorageClient();
    await storage.putObject('tenants/t1/outputs/job-a/result.json', '{}');
    await storage.putObject('tenants/t1/outputs/job-a/output.png', 'img');
    await storage.putObject('tenants/t1/outputs/job-b/result.json', '{}');
    await storage.putObject('tenants/t2/outputs/job-c/result.json', '{}');

    const listed = await storage.listKeysByPrefix('tenants/t1/outputs/');
    assert.equal(listed.length, 3);

    const deleted = await storage.deleteByPrefix('tenants/t1/outputs/job-a/');
    assert.equal(deleted, 2);
    assert.equal((await storage.listKeysByPrefix('tenants/t1/outputs/')).length, 1);
    assert.ok(await storage.getObject('tenants/t2/outputs/job-c/result.json'));
  });
});

