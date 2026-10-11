import { randomUUID } from 'node:crypto';
import type {
  DlqMessage,
  IQueueClient,
  QueueMessage,
  ReceivedDlqMessage,
  ReceivedMessage,
} from './queue-client.js';

interface QueuedItem {
  messageId: string;
  body: QueueMessage;
  receiveCount: number;
  visibleAfter: number;
}

interface InFlightItem extends QueuedItem {
  receiptHandle: string;
}

interface DlqItem {
  messageId: string;
  receiptHandle: string;
  body: DlqMessage;
  receiveCount: number;
}

export class InMemoryQueueClient implements IQueueClient {
  private queue: QueuedItem[] = [];
  private inFlight: Map<string, InFlightItem> = new Map();
  private dlq: DlqItem[] = [];
  private healthy = true;
  private maxReceiveCount: number;

  constructor(options: { maxReceiveCount?: number } = {}) {
    this.maxReceiveCount = options.maxReceiveCount ?? 3;
  }

  setHealthy(status: boolean): void {
    this.healthy = status;
  }

  async sendMessage(message: QueueMessage, delaySeconds = 0): Promise<string> {
    const id = randomUUID();
    this.queue.push({
      messageId: id,
      body: message,
      receiveCount: 0,
      visibleAfter: Date.now() + Math.max(delaySeconds, 0) * 1000,
    });
    return id;
  }

  async receiveMessages(maxMessages = 1): Promise<ReceivedMessage[]> {
    const now = Date.now();

    // Check if any in-flight messages timed out and return them to the queue
    for (const [receiptHandle, item] of this.inFlight.entries()) {
      if (item.visibleAfter <= now) {
        this.inFlight.delete(receiptHandle);
        if (item.receiveCount >= this.maxReceiveCount) {
          this.dlq.push({
            messageId: item.messageId,
            receiptHandle: randomUUID(),
            body: {
              ...item.body,
              failureReason: 'Max receive count exceeded (visibility timeout redrive)',
              errorCode: 'MAX_RECEIVE_COUNT_EXCEEDED',
              retryCount: item.receiveCount,
              failedAt: new Date(now).toISOString(),
            },
            receiveCount: item.receiveCount,
          });
        } else {
          this.queue.unshift({
            messageId: item.messageId,
            body: item.body,
            receiveCount: item.receiveCount,
            visibleAfter: now,
          });
        }
      }
    }

    const results: ReceivedMessage[] = [];
    const remainingQueue: QueuedItem[] = [];

    for (const item of this.queue) {
      if (results.length < maxMessages && item.visibleAfter <= now) {
        const nextReceiveCount = item.receiveCount + 1;
        const receiptHandle = randomUUID();
        this.inFlight.set(receiptHandle, {
          messageId: item.messageId,
          receiptHandle,
          body: item.body,
          receiveCount: nextReceiveCount,
          visibleAfter: now + 30000, // 30s default visibility
        });

        results.push({
          messageId: item.messageId,
          receiptHandle,
          body: item.body,
          approximateReceiveCount: nextReceiveCount,
        });
      } else {
        remainingQueue.push(item);
      }
    }

    this.queue = remainingQueue;
    return results;
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    this.inFlight.delete(receiptHandle);
  }

  async changeMessageVisibility(receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void> {
    const item = this.inFlight.get(receiptHandle);
    if (item) {
      if (visibilityTimeoutSeconds <= 0) {
        this.inFlight.delete(receiptHandle);
        if (item.receiveCount >= this.maxReceiveCount) {
          this.dlq.push({
            messageId: item.messageId,
            receiptHandle: randomUUID(),
            body: {
              ...item.body,
              failureReason: 'Max receive count exceeded',
              errorCode: 'MAX_RECEIVE_COUNT_EXCEEDED',
              retryCount: item.receiveCount,
              failedAt: new Date().toISOString(),
            },
            receiveCount: item.receiveCount,
          });
        } else {
          this.queue.push({
            messageId: item.messageId,
            body: item.body,
            receiveCount: item.receiveCount,
            visibleAfter: Date.now(),
          });
        }
      } else {
        item.visibleAfter = Date.now() + visibilityTimeoutSeconds * 1000;
      }
    }
  }

  async sendToDlq(message: DlqMessage): Promise<string> {
    const messageId = randomUUID();
    this.dlq.push({
      messageId,
      receiptHandle: randomUUID(),
      body: message,
      receiveCount: message.retryCount || 1,
    });
    return messageId;
  }

  async receiveDlqMessages(maxMessages = 10): Promise<ReceivedDlqMessage[]> {
    return this.dlq.slice(0, maxMessages).map((item) => ({
      messageId: item.messageId,
      receiptHandle: item.receiptHandle,
      body: item.body,
      approximateReceiveCount: item.receiveCount,
    }));
  }

  async deleteDlqMessage(receiptHandle: string): Promise<void> {
    this.dlq = this.dlq.filter((item) => item.receiptHandle !== receiptHandle);
  }

  async isHealthy(): Promise<boolean> {
    return this.healthy;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getDlqLength(): number {
    return this.dlq.length;
  }

  clear(): void {
    this.queue = [];
    this.inFlight.clear();
    this.dlq = [];
  }
}


