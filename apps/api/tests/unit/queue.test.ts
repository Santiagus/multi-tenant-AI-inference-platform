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

  test('redrives messages exceeding maxReceiveCount to DLQ and supports DLQ deletion', async () => {
    const queue = new InMemoryQueueClient({ maxReceiveCount: 2 });
    await queue.sendMessage({
      jobId: 'job-poison',
      tenantId: 'tenant-1',
      modelId: 'llama-3',
      routingPreference: 'auto',
      priority: 5,
      createdAt: new Date().toISOString(),
    });

    // Receive 1
    const rec1 = await queue.receiveMessages(1);
    assert.equal(rec1[0].approximateReceiveCount, 1);
    await queue.changeMessageVisibility(rec1[0].receiptHandle, 0);

    // Receive 2
    const rec2 = await queue.receiveMessages(1);
    assert.equal(rec2[0].approximateReceiveCount, 2);
    // Exceeds maxReceiveCount (2) on visibility timeout = 0 -> moves to DLQ
    await queue.changeMessageVisibility(rec2[0].receiptHandle, 0);

    assert.equal(queue.getQueueLength(), 0);
    assert.equal(queue.getDlqLength(), 1);

    const dlqMsgs = await queue.receiveDlqMessages(10);
    assert.equal(dlqMsgs.length, 1);
    assert.equal(dlqMsgs[0].body.jobId, 'job-poison');
    assert.equal(dlqMsgs[0].body.errorCode, 'MAX_RECEIVE_COUNT_EXCEEDED');

    await queue.deleteDlqMessage(dlqMsgs[0].receiptHandle);
    assert.equal(queue.getDlqLength(), 0);
  });
});


