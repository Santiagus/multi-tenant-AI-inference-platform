import type { IStorageClient } from './storage-client.js';

export class InMemoryStorageClient implements IStorageClient {
  private store = new Map<string, { data: Buffer; contentType: string }>();
  private healthy = true;

  setHealthy(status: boolean): void {
    this.healthy = status;
  }

  async putObject(key: string, data: Buffer | string, contentType = 'application/octet-stream'): Promise<string> {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    this.store.set(key, { data: buffer, contentType });
    return `s3://mock-bucket/${key}`;
  }

  async getObject(key: string): Promise<Buffer | null> {
    const item = this.store.get(key);
    return item ? item.data : null;
  }

  async getPresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return `https://storage.mock.local/download/${encodeURIComponent(key)}?expires=${expiresInSeconds}`;
  }

  async getPresignedUploadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return `https://storage.mock.local/upload/${encodeURIComponent(key)}?expires=${expiresInSeconds}`;
  }

  async ensureBucket(): Promise<void> {
    // No-op for in-memory
  }

  async isHealthy(): Promise<boolean> {
    return this.healthy;
  }

  clear(): void {
    this.store.clear();
  }
}
