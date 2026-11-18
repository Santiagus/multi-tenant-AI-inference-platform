import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { IStorageClient } from './storage-client.js';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  publicEndpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export class S3StorageClient implements IStorageClient {
  private client: S3Client;
  private presignClient: S3Client;
  private bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    const credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials,
    });
    this.presignClient = config.publicEndpoint
      ? new S3Client({
          region: config.region,
          endpoint: config.publicEndpoint,
          forcePathStyle: config.forcePathStyle ?? true,
          credentials,
        })
      : this.client;
  }

  async putObject(key: string, data: Buffer | string, contentType = 'application/octet-stream'): Promise<string> {
    const body = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    return `s3://${this.bucket}/${key}`;
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      if (!response.Body) {
        return null;
      }
      const byteArray = await response.Body.transformToByteArray();
      return Buffer.from(byteArray);
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NoSuchKey' || (err as { '$metadata'?: { httpStatusCode?: number } })['$metadata']?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.presignClient, command, { expiresIn: expiresInSeconds });
  }

  async getPresignedUploadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.presignClient, command, { expiresIn: expiresInSeconds });
  }

  getAssetUri(key: string): string {
    return `s3://${this.bucket}/${key}`;
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch {
        // Ignored if bucket exists or created concurrently
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.send(
        new HeadBucketCommand({
          Bucket: this.bucket,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async listKeysByPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of response.Contents ?? []) {
        if (obj.Key) {
          keys.push(obj.Key);
        }
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const keys = await this.listKeysByPrefix(prefix);
    if (keys.length === 0) {
      return 0;
    }
    let deleted = 0;
    // S3 DeleteObjects accepts at most 1000 keys per request.
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      const response = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      deleted += chunk.length - (response.Errors?.length ?? 0);
    }
    return deleted;
  }
}
