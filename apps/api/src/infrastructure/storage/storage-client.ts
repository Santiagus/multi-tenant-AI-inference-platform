export interface IStorageClient {
  putObject(key: string, data: Buffer | string, contentType?: string): Promise<string>;
  getObject(key: string): Promise<Buffer | null>;
  getPresignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getPresignedUploadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  ensureBucket(): Promise<void>;
  isHealthy(): Promise<boolean>;
}
