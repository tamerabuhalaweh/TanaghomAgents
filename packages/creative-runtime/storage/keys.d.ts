export declare const MAX_OBJECT_READ_BYTES: number;
export declare function extensionForMime(mime: string): string;
export declare function buildObjectKey(input: {
  organizationId: string;
  capability: string;
  assetId: string;
  version: number;
  mime: string;
}): string;
export declare function parseObjectKey(key: string): {
  organizationId: string;
  capability: string;
  assetId: string;
  version: number;
  mime: string;
};
export declare function assertObjectKeyShape(key: string): true;
export declare function mimeForObjectKey(key: string): string;
export declare function sha256Hex(bytes: Buffer): string;
export declare function verifyChecksum(bytes: Buffer, expectedHex: string): boolean;
