import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import type {
  DlqMessage,
  IQueueClient,
  QueueMessage,
  ReceivedDlqMessage,
  ReceivedMessage,
} from './queue-client.js';

export interface SqsQueueConfig {
  queueUrl: string;
  dlqUrl?: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export class SqsQueueClient implements IQueueClient {
  private client: SQSClient;
  private queueUrl: string;
  private dlqUrl: string;

  constructor(config: SqsQueueConfig) {
    this.queueUrl = config.queueUrl;
    this.dlqUrl = config.dlqUrl ?? `${config.queueUrl}-dlq`;
    this.client = new SQSClient({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId ?? 'elasticmq',
        secretAccessKey: config.secretAccessKey ?? 'elasticmq',
      },
    });
  }

  async sendMessage(message: QueueMessage, delaySeconds = 0): Promise<string> {
    const response = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        DelaySeconds: Math.min(Math.max(delaySeconds, 0), 900),
        MessageAttributes: {
          tenantId: {
            DataType: 'String',
            StringValue: message.tenantId,
          },
          modelId: {
            DataType: 'String',
            StringValue: message.modelId,
          },
          ...(message.correlationId
            ? {
                correlationId: {
                  DataType: 'String',
                  StringValue: message.correlationId,
                },
              }
            : {}),
          ...(message.traceparent
            ? {
                traceparent: {
                  DataType: 'String',
                  StringValue: message.traceparent,
                },
              }
            : {}),
        },
      })
    );
    return response.MessageId ?? '';
  }

  async receiveMessages(maxMessages = 1, waitTimeSeconds = 0): Promise<ReceivedMessage[]> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: Math.min(Math.max(maxMessages, 1), 10),
        WaitTimeSeconds: waitTimeSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      })
    );

    if (!response.Messages || response.Messages.length === 0) {
      return [];
    }

    return response.Messages.map((msg) => {
      const body = JSON.parse(msg.Body ?? '{}') as QueueMessage;
      const count = Number(msg.Attributes?.ApproximateReceiveCount ?? '1');
      return {
        messageId: msg.MessageId ?? '',
        receiptHandle: msg.ReceiptHandle ?? '',
        body,
        approximateReceiveCount: isNaN(count) ? 1 : count,
      };
    });
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      })
    );
  }

  async changeMessageVisibility(receiptHandle: string, visibilityTimeoutSeconds: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeoutSeconds,
      })
    );
  }

  async sendToDlq(message: DlqMessage): Promise<string> {
    const response = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.dlqUrl,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          tenantId: {
            DataType: 'String',
            StringValue: message.tenantId,
          },
          errorCode: {
            DataType: 'String',
            StringValue: message.errorCode,
          },
        },
      })
    );
    return response.MessageId ?? '';
  }

  async receiveDlqMessages(maxMessages = 10): Promise<ReceivedDlqMessage[]> {
    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.dlqUrl,
        MaxNumberOfMessages: Math.min(Math.max(maxMessages, 1), 10),
        VisibilityTimeout: 0,
        WaitTimeSeconds: 0,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      })
    );

    if (!response.Messages || response.Messages.length === 0) {
      return [];
    }

    return response.Messages.map((msg) => {
      const body = JSON.parse(msg.Body ?? '{}') as DlqMessage;
      const count = Number(msg.Attributes?.ApproximateReceiveCount ?? '1');
      return {
        messageId: msg.MessageId ?? '',
        receiptHandle: msg.ReceiptHandle ?? '',
        body,
        approximateReceiveCount: isNaN(count) ? 1 : count,
      };
    });
  }

  async deleteDlqMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.dlqUrl,
        ReceiptHandle: receiptHandle,
      })
    );
  }

  async getQueueDepth(): Promise<number> {
    try {
      const res = await this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        })
      );
      const val = Number(res.Attributes?.ApproximateNumberOfMessages ?? '0');
      return isNaN(val) ? 0 : val;
    } catch {
      return 0;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        })
      );
      return true;
    } catch {
      return false;
    }
  }
}

