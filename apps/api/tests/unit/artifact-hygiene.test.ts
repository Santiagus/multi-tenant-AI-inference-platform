import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractOutputJobIdsFromKeys,
  findOrphanOutputPrefixes,
  purgeOrphanOutputPrefixes,
  resolveArtifactFlags,
  deleteJobArtifactPrefixes,
} from '../../src/application/artifact-hygiene.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';

describe('Artifact hygiene helpers', () => {
  it('resolves has_artifacts and kind from outputUri + model modality', () => {
    assert.deepEqual(resolveArtifactFlags({ outputUri: null, modelId: 'meta-llama/Llama-3-8B' }), {
      has_artifacts: false,
      artifact_kind: null,
    });
    assert.deepEqual(
      resolveArtifactFlags({
        outputUri: 's3://bucket/tenants/t/outputs/j/result.json',
        modelId: 'meta-llama/Llama-3-8B',
      }),
      { has_artifacts: true, artifact_kind: 'json' }
    );
    assert.deepEqual(
      resolveArtifactFlags({
        outputUri: 's3://bucket/tenants/t/outputs/j/result.json',
        modelId: 'black-forest-labs/FLUX.1-schnell',
      }),
      { has_artifacts: true, artifact_kind: 'image' }
    );
    assert.deepEqual(
      resolveArtifactFlags({
        outputUri: 's3://bucket/tenants/t/outputs/j/result.json',
        modelId: 'Wan-AI/Wan2.1-T2V-1.3B',
      }),
      { has_artifacts: true, artifact_kind: 'video' }
    );
  });

  it('extracts job folder ids from output keys', () => {
    const ids = extractOutputJobIdsFromKeys('tenant-default', [
      'tenants/tenant-default/outputs/job-1/result.json',
      'tenants/tenant-default/outputs/job-1/output.png',
      'tenants/tenant-default/outputs/job-2/result.json',
      'tenants/other/outputs/job-x/result.json',
    ]);
    assert.deepEqual(ids, ['job-1', 'job-2']);
  });

  it('finds and purges orphan output prefixes', async () => {
    const storage = new InMemoryStorageClient();
    await storage.putObject('tenants/t1/outputs/alive/result.json', '{}');
    await storage.putObject('tenants/t1/outputs/orphan/result.json', '{}');
    await storage.putObject('tenants/t1/outputs/orphan/output.png', 'img');

    const orphans = await findOrphanOutputPrefixes(storage, 't1', ['alive']);
    assert.deepEqual(orphans, ['tenants/t1/outputs/orphan/']);

    const deleted = await purgeOrphanOutputPrefixes(storage, orphans);
    assert.equal(deleted, 2);
    assert.equal((await storage.listKeysByPrefix('tenants/t1/outputs/')).length, 1);
  });

  it('cascades deleteJobArtifactPrefixes for job output folders', async () => {
    const storage = new InMemoryStorageClient();
    await storage.putObject('tenants/t1/outputs/j1/result.json', '{}');
    await storage.putObject('tenants/t1/outputs/j2/result.json', '{}');

    const deleted = await deleteJobArtifactPrefixes(storage, [
      { id: 'j1', tenantId: 't1', inputUri: null },
    ]);
    assert.equal(deleted, 1);
    assert.equal(await storage.getObject('tenants/t1/outputs/j1/result.json'), null);
    assert.ok(await storage.getObject('tenants/t1/outputs/j2/result.json'));
  });
});
