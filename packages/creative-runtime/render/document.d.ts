export interface DesignCanvas {
  width: 1080;
  height: 1080 | 1350 | 1920;
}

export interface DesignNode {
  id: string;
  type: "text" | "image" | "shape" | "badge";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  role?: "headline" | "body" | "cta" | "price" | "caption" | "logo" | "product" | "background" | "decoration";
  font_size?: number;
  font_weight?: 400 | 500 | 600 | 700 | 800;
  align?: "start" | "end" | "center";
  color?: string;
  background_color?: string;
  asset_version_id?: string;
  corner_radius?: number;
}

export interface DesignPage {
  id: string;
  kind?: "cover" | "body" | "end";
  nodes: DesignNode[];
}

export interface DesignDocument {
  kind: "ad" | "carousel";
  locale: "ar" | "en";
  direction: "rtl" | "ltr";
  canvas: DesignCanvas;
  background?: { color?: string; image_version_id?: string };
  brand_kit_version_id?: string | null;
  nodes?: DesignNode[];
  pages?: DesignPage[];
}

export interface RenderAsset {
  bytes: Buffer;
  mime: string;
}

export function escapeHtml(text: unknown): string;
export function validateNode(node: unknown, canvas: { width: number; height: number }, seen: Set<string>): void;
export function validateDocument(doc: unknown): { pages: string[]; canvas: { width: number; height: number } };
export function buildPageHtml(args: {
  doc: DesignDocument;
  pageId: string;
  assets: Map<string, RenderAsset>;
  fontCss?: string;
  fontFamily?: string;
}): string;
export function buildDocumentHtml(args: {
  doc: DesignDocument;
  assets: Map<string, RenderAsset>;
  fontCss?: string;
  fontFamily?: string;
}): Array<{ pageId: string; html: string }>;
export function bundledFontCss(fontDir?: string): string;
