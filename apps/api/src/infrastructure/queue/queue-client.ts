export interface QueueMessage {
  jobId: string;
  tenantId: string;
  modelId: string;
  routingPreference: string;
  priority: number;
  correlationId?: string | null;
  traceparent?: string | null;
  inputUri?: string | null;
  inputPayload?: Record<string, unknown> | null;
  createdAt: string;
}

export interface DlqMessage extends QueueMessage {
  failureReason: string;
  errorCode: string;
  retryCount: number;
  failedAt: string;
}

export interface ReceivedMessage {
  messageId: string;
  receiptHandle: string;
  body: QueueMessage;
  approximateReceiveCount: number;
}

export interface ReceivedDlqMessage {
  messageId: string;
  receiptHandle: string;
  body: DlqMessage;
  approximateReceiveCount: number;
}

export interface IQueueClient {
  sendMessage(message: QueueMessage, delaySeconds?: number): Promise<string>;
  receiveMessages(maxMessages?: number, waitTimeSeconds?: number): Promise<ReceivedMessage[]>;
  deleteMessage(receiptHandle: string): Promise<void>;
  changeMessageVisibility(receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void>;
  sendToDlq(message: DlqMessage): Promise<string>;
  receiveDlqMessages(maxMessages?: number): Promise<ReceivedDlqMessage[]>;
  deleteDlqMessage(receiptHandle: string): Promise<void>;
  getQueueDepth?(): Promise<number>;
  isHealthy(): Promise<boolean>;
}


