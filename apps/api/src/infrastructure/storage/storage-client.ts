export interface IStorageClient {
  putObject(key: string, data: Buffer | string, contentType?: string): Promise<string>;
  getObject(key: string): Promise<Buffer | null>;
  getPresignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getPresignedUploadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getAssetUri(key: string): string;
  ensureBucket(): Promise<void>;
  isHealthy(): Promise<boolean>;
  /** List object keys under a prefix (S3 ListObjectsV2 / in-memory scan). */
  listKeysByPrefix(prefix: string): Promise<string[]>;
  /** Delete all objects under a prefix. Returns number of deleted keys. */
  deleteByPrefix(prefix: string): Promise<number>;
}
