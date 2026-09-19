export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface StorageDriver {
  readonly name: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * A URL that grants time-limited read access. Platform adapters hand this to
   * networks that fetch media themselves, so it must be reachable from the
   * public internet in production.
   */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /**
   * A URL the browser can PUT bytes to, skipping this application entirely.
   *
   * Null when the driver has no such thing. That is the local disk driver,
   * which needs none: the ceiling this exists to clear is a hosting platform's
   * request body limit, and there is no platform in front of a local disk.
   */
  signedUploadUrl?(key: string, contentType: string, expiresInSeconds?: number): Promise<string | null>;
}
