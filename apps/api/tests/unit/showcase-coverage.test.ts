import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_PLACEMENTS,
  SHOWCASE_ENGINES,
  SHOWCASE_MODALITIES,
  SHOWCASE_PRIORITIES,
  SHOWCASE_ROUTING_STRATEGIES,
  SHOWCASE_STATUSES,
  assertShowcaseCoverage,
  buildShowcaseJobTemplates,
  collectShowcaseCoverage,
  isPaintedShowcaseJobId,
  paintedJobId,
  placementForProvider,
  telemetryBackend,
} from '../../src/infrastructure/db/seeds/showcase-coverage.js';
import { purgeShowcaseDlq, seedShowcaseDlq } from '../../src/infrastructure/db/seeds/showcase-seed.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('Showcase coverage matrix (TC-92)', () => {
  it('builds templates covering all required showcase dimensions', () => {
    const jobs = buildShowcaseJobTemplates();
    assert.ok(jobs.length >= 40);
    assert.doesNotThrow(() => assertShowcaseCoverage(jobs));

    const coverage = collectShowcaseCoverage(jobs);
    for (const status of SHOWCASE_STATUSES) {
      assert.ok(coverage.statuses.has(status), `missing status ${status}`);
    }
    for (const eng of SHOWCASE_ENGINES) {
      assert.ok(coverage.engines.has(eng.executed), `missing engine ${eng.executed}`);
    }
    for (const modality of SHOWCASE_MODALITIES) {
      assert.ok(coverage.modalities.has(modality), `missing modality ${modality}`);
    }
    for (const routing of SHOWCASE_ROUTING_STRATEGIES) {
      assert.ok(coverage.routings.has(routing), `missing routing ${routing}`);
    }
    for (const priority of SHOWCASE_PRIORITIES) {
      assert.ok(coverage.priorities.has(priority), `missing priority ${priority}`);
    }
    for (const placement of REQUIRED_PLACEMENTS) {
      assert.ok(coverage.placements.has(placement), `missing placement ${placement}`);
    }
    assert.equal(coverage.hasLocalCpu, true);
    assert.equal(coverage.hasLocalGpu, true);
    assert.equal(coverage.hasDlqFixture, true);
  });

  it('excludes hourly-only providers from duration-metered placement set', () => {
    const jobs = buildShowcaseJobTemplates().filter((j) => j.tenant === 'tenant-demo');
    const providers = new Set(jobs.map((j) => j.provider));
    assert.equal(providers.has('nebius'), false);
    assert.equal(providers.has('neocloudz'), false);
  });

  it('maps painted ids and telemetry backends for UI engine labels', () => {
    assert.equal(paintedJobId(1), '00000000-0000-4000-a000-000000000001');
    assert.equal(isPaintedShowcaseJobId('00000000-0000-4000-a000-000000000002'), true);
    assert.equal(isPaintedShowcaseJobId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), false);

    assert.equal(telemetryBackend('auto', 'cuda', 'auto'), 'pytorch_torchscript_cuda');
    assert.equal(telemetryBackend('numpy', 'cpu', 'numpy'), 'numpy_cpu');
    assert.equal(telemetryBackend('torch-compile', 'cuda', 'torch-compile'), 'pytorch_torch_compile_cuda');
    assert.equal(placementForProvider('bedrock', 'cloud/bedrock'), 'token_factory');
    assert.equal(placementForProvider('local', 'local/cpu'), 'local');
  });

  it('seeds and purges painted DLQ envelopes via queue client', async () => {
    const queue = new InMemoryQueueClient();
    const jobs = buildShowcaseJobTemplates();
    const dlqJobs = jobs
      .map((template, i) => ({ jobId: paintedJobId(i + 1), template }))
      .filter((row) => row.template.seedDlq);

    assert.ok(dlqJobs.length >= 1);
    const seeded = await seedShowcaseDlq(queue, dlqJobs);
    assert.equal(seeded, dlqJobs.length);

    const before = await queue.receiveDlqMessages(10);
    assert.ok(before.length >= 1);
    assert.ok(before.every((m) => isPaintedShowcaseJobId(m.body.jobId)));
    assert.equal(before[0].body.tenantId, 'tenant-demo');
    assert.equal(before[0].body.errorCode, 'INFERENCE_ERROR');

    // Re-seed path purges then inserts; verify purge clears painted messages.
    const purged = await purgeShowcaseDlq(queue);
    assert.ok(purged >= 1);
    const after = await queue.receiveDlqMessages(10);
    assert.equal(after.length, 0);
  });
});
