import { randomUUID } from 'node:crypto';
import type { IQueueClient, QueueMessage, ReceivedMessage } from './queue-client.js';

interface InFlightItem {
  messageId: string;
  receiptHandle: string;
  body: QueueMessage;
  receiveCount: number;
  visibleAfter: number;
}

export class InMemoryQueueClient implements IQueueClient {
  private queue: QueueMessage[] = [];
  private inFlight: Map<string, InFlightItem> = new Map();
  private healthy = true;

  setHealthy(status: boolean): void {
    this.healthy = status;
  }

  async sendMessage(message: QueueMessage): Promise<string> {
    const id = randomUUID();
    this.queue.push(message);
    return id;
  }

  async receiveMessages(maxMessages = 1): Promise<ReceivedMessage[]> {
    const now = Date.now();

    // Check if any in-flight messages timed out and return them to the queue
    for (const [receiptHandle, item] of this.inFlight.entries()) {
      if (item.visibleAfter <= now) {
        this.inFlight.delete(receiptHandle);
        this.queue.unshift(item.body);
      }
    }

    const count = Math.min(maxMessages, this.queue.length);
    const results: ReceivedMessage[] = [];

    for (let i = 0; i < count; i++) {
      const body = this.queue.shift();
      if (!body) break;

      const messageId = randomUUID();
      const receiptHandle = randomUUID();
      this.inFlight.set(receiptHandle, {
        messageId,
        receiptHandle,
        body,
        receiveCount: 1,
        visibleAfter: now + 30000, // 30s default visibility
      });

      results.push({
        messageId,
        receiptHandle,
        body,
        approximateReceiveCount: 1,
      });
    }

    return results;
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    this.inFlight.delete(receiptHandle);
  }

  async changeMessageVisibility(receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void> {
    const item = this.inFlight.get(receiptHandle);
    if (item) {
      item.visibleAfter = Date.now() + visibilityTimeoutSeconds * 1000;
    }
  }

  async isHealthy(): Promise<boolean> {
    return this.healthy;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    this.inFlight.clear();
  }
}

