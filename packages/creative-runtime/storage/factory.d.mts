export interface CreativeStoragePutResult {
  key: string;
  sha256: string;
  bytes: number;
  etag?: string | null;
}

export interface CreativeStorage {
  readonly kind: string;
  put(key: string, bytes: Buffer, mime: string): Promise<CreativeStoragePutResult>;
  get(key: string, maxBytes?: number): Promise<{ bytes: Buffer; mime: string } | null>;
  remove(key: string): Promise<{ key: string; deleted: boolean }>;
}

export interface CreativeStorageOptions {
  env?: Record<string, string | undefined>;
  mode?: "test" | "harness" | "development" | "production";
  backend?: "local" | "s3";
  dir?: string;
  fetchImpl?: typeof fetch;
  deadlineMs?: number;
  readLimitBytes?: number;
}

export declare const STORAGE_BACKENDS: readonly ["local", "s3"];
export declare const MAX_OBJECT_READ_BYTES: number;

export declare function storageModeForEnv(env?: Record<string, string | undefined>): "production" | "development";

export interface CreativeStorageConfigSummary {
  mode: string;
  backend: "local" | "s3";
  dir?: string;
  endpoint?: string;
  region?: string;
  bucket?: string;
  conditionalWrites?: boolean;
}

export declare function readCreativeStorageConfig(env?: Record<string, string | undefined>): CreativeStorageConfigSummary;

export declare function createCreativeStorage(options?: CreativeStorageOptions): CreativeStorage;
