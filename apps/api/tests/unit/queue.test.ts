import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('Queue Abstraction', () => {
  test('sends and receives messages', async () => {
    const queue = new InMemoryQueueClient();
    const messageId = await queue.sendMessage({
      jobId: 'job-1',
      tenantId: 'tenant-1',
      modelId: 'llama-3',
      routingPreference: 'auto',
      priority: 5,
      createdAt: new Date().toISOString(),
    });

    assert.ok(messageId);
    assert.equal(queue.getQueueLength(), 1);

    const received = await queue.receiveMessages(1);
    assert.equal(received.length, 1);
    assert.equal(received[0].body.jobId, 'job-1');
    assert.equal(received[0].approximateReceiveCount, 1);
    assert.equal(queue.getQueueLength(), 0);

    // Delete message after processing
    await queue.deleteMessage(received[0].receiptHandle);
  });

  test('returns empty array when queue is empty', async () => {
    const queue = new InMemoryQueueClient();
    const received = await queue.receiveMessages(5);
    assert.equal(received.length, 0);
  });

  test('reflects health status correctly', async () => {
    const queue = new InMemoryQueueClient();
    assert.equal(await queue.isHealthy(), true);

    queue.setHealthy(false);
    assert.equal(await queue.isHealthy(), false);
  });
});

