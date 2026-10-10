export interface QueueMessage {
  jobId: string;
  tenantId: string;
  modelId: string;
  routingPreference: string;
  priority: number;
  inputUri?: string | null;
  inputPayload?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ReceivedMessage {
  messageId: string;
  receiptHandle: string;
  body: QueueMessage;
  approximateReceiveCount: number;
}

export interface IQueueClient {
  sendMessage(message: QueueMessage): Promise<string>;
  receiveMessages(maxMessages?: number, waitTimeSeconds?: number): Promise<ReceivedMessage[]>;
  deleteMessage(receiptHandle: string): Promise<void>;
  changeMessageVisibility(receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void>;
  isHealthy(): Promise<boolean>;
}

