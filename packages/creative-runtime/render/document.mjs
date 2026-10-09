// Deterministic design-document renderer (P2b). Pure functions, zero
// dependencies: validates a design document and emits one self-contained
// HTML string per page. No scripts, no external references, no network:
// text is escaped, images arrive as data URIs supplied by the caller,
// fonts arrive as data URIs from the bundled allowlist.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MAX_NODES_PER_PAGE = 24;
const MAX_TEXT_LENGTH = 2000;
const NODE_TYPES = new Set(["text", "image", "shape", "badge"]);
const NODE_ROLES = new Set(["headline", "body", "cta", "price", "caption", "logo", "product", "background", "decoration"]);
const NODE_ALIGNS = new Set(["start", "end", "center"]);
const FONT_WEIGHTS = new Set([400, 500, 600, 700, 800]);
const CANVAS_WIDTHS = new Set([1080]);
const CANVAS_HEIGHTS = new Set([1080, 1350, 1920]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function fail(message) {
  throw new Error(`invalid_design_document:${message}`);
}

function checkInt(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label}_bounds`);
}

export function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function checkColor(value, label) {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) fail(`${label}_color`);
}

export function validateNode(node, canvas, seen) {
  if (!node || typeof node !== "object" || Array.isArray(node)) fail("node_shape");
  const keys = new Set([
    "id", "type", "x", "y", "width", "height", "text", "role", "font_size",
    "font_weight", "align", "color", "background_color", "asset_version_id", "corner_radius",
  ]);
  for (const key of Object.keys(node)) {
    if (!keys.has(key)) fail(`unknown_node_property:${key}`);
  }
  if (typeof node.id !== "string" || !ID_RE.test(node.id)) fail("node_id");
  if (seen.has(node.id)) fail("duplicate_node_id");
  seen.add(node.id);
  if (!NODE_TYPES.has(node.type)) fail("node_type");
  checkInt(node.x, 0, canvas.width, "node_x");
  checkInt(node.y, 0, canvas.height, "node_y");
  checkInt(node.width, 8, canvas.width, "node_width");
  checkInt(node.height, 8, canvas.height, "node_height");
  if (node.x + node.width > canvas.width || node.y + node.height > canvas.height) fail("node_out_of_canvas");
  if (node.type === "text") {
    if (typeof node.text !== "string" || node.text.length < 1 || node.text.length > MAX_TEXT_LENGTH) fail("node_text");
    if (node.role !== undefined && !NODE_ROLES.has(node.role)) fail("node_role");
    if (node.font_size !== undefined) checkInt(node.font_size, 10, 220, "font_size");
    if (node.font_weight !== undefined && !FONT_WEIGHTS.has(node.font_weight)) fail("font_weight");
    if (node.align !== undefined && !NODE_ALIGNS.has(node.align)) fail("node_align");
    if (node.color !== undefined) checkColor(node.color, "text");
  }
  if (node.type === "image") {
    if (typeof node.asset_version_id !== "string" || !node.asset_version_id) fail("image_asset_ref");
  }
  if (node.type === "shape" || node.type === "badge") {
    if (node.background_color !== undefined) checkColor(node.background_color, "shape");
  }
  if (node.background_color !== undefined && node.type !== "shape" && node.type !== "badge") fail("background_color_misplaced");
  if (node.corner_radius !== undefined) checkInt(node.corner_radius, 0, 540, "corner_radius");
  if (node.asset_version_id !== undefined && node.type !== "image" && node.type !== "badge") fail("asset_ref_misplaced");
}

export function validateDocument(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail("document_shape");
  if (doc.kind !== "ad" && doc.kind !== "carousel") fail("document_kind");
  if (doc.locale !== "ar" && doc.locale !== "en") fail("document_locale");
  if (doc.direction !== "rtl" && doc.direction !== "ltr") fail("document_direction");
  if ((doc.locale === "ar" && doc.direction !== "rtl") || (doc.locale === "en" && doc.direction !== "ltr")) {
    fail("locale_direction_mismatch");
  }
  const canvas = doc.canvas ?? {};
  if (!CANVAS_WIDTHS.has(canvas.width) || !CANVAS_HEIGHTS.has(canvas.height)) fail("canvas_size");
  const pages = doc.kind === "carousel" ? doc.pages : [{ id: "page-1", kind: "body", nodes: doc.nodes }];
  if (doc.kind === "carousel") {
    if (!Array.isArray(pages) || pages.length < 2 || pages.length > 10) fail("page_count");
  } else {
    if (!Array.isArray(doc.nodes) || doc.nodes.length < 1 || doc.nodes.length > MAX_NODES_PER_PAGE) fail("node_count");
  }
  const seenPages = new Set();
  for (const page of pages) {
    if (!page || typeof page !== "object") fail("page_shape");
    if (typeof page.id !== "string" || !ID_RE.test(page.id)) fail("page_id");
    if (seenPages.has(page.id)) fail("duplicate_page_id");
    seenPages.add(page.id);
    if (doc.kind === "carousel" && !["cover", "body", "end"].includes(page.kind)) fail("page_kind");
    if (!Array.isArray(page.nodes) || page.nodes.length < 1 || page.nodes.length > MAX_NODES_PER_PAGE) fail("page_node_count");
    const seen = new Set();
    for (const node of page.nodes) validateNode(node, canvas, seen);
  }
  if (doc.background !== undefined) {
    if (typeof doc.background !== "object" || Array.isArray(doc.background)) fail("background_shape");
    if (doc.background.color !== undefined) checkColor(doc.background.color, "background");
    if (doc.background.image_version_id !== undefined && typeof doc.background.image_version_id !== "string") fail("background_asset_ref");
    for (const key of Object.keys(doc.background)) {
      if (!["color", "image_version_id"].includes(key)) fail(`unknown_background_property:${key}`);
    }
  }
  return { pages: pages.map((page) => page.id), canvas: { width: canvas.width, height: canvas.height } };
}

function textAlign(align, direction) {
  if (align === "center") return "center";
  if (direction === "rtl") return align === "start" ? "right" : "left";
  return align === "start" ? "left" : "right";
}

function renderTextNode(node, direction) {
  const style = [
    `left:${node.x}px`, `top:${node.y}px`, `width:${node.width}px`, `height:${node.height}px`,
    `color:${node.color ?? "#111111"}`,
    `font-size:${node.font_size ?? 48}px`,
    `font-weight:${node.font_weight ?? 700}`,
    `text-align:${textAlign(node.align ?? "start", direction)}`,
    "position:absolute", "overflow:hidden", "white-space:pre-wrap", "overflow-wrap:break-word",
  ].join(";");
  return `<div class="tanaghom-text" data-node="${escapeHtml(node.id)}" style="${style}">${escapeHtml(node.text)}</div>`;
}

function renderShapeNode(node) {
  const style = [
    `left:${node.x}px`, `top:${node.y}px`, `width:${node.width}px`, `height:${node.height}px`,
    `background:${node.background_color ?? "#e2e8f0"}`,
    `border-radius:${node.corner_radius ?? 0}px`,
    "position:absolute",
  ].join(";");
  return `<div class="tanaghom-shape" data-node="${escapeHtml(node.id)}" style="${style}"></div>`;
}

function renderBadgeNode(node, direction) {
  const style = [
    `left:${node.x}px`, `top:${node.y}px`, `min-width:${node.width}px`, `min-height:${node.height}px`,
    `background:${node.background_color ?? "#0f766e"}`,
    `color:${node.color ?? "#ffffff"}`,
    `border-radius:${node.corner_radius ?? 999}px`,
    `font-size:${node.font_size ?? 32}px`, `font-weight:${node.font_weight ?? 700}`,
    "position:absolute", "display:flex", "align-items:center", "justify-content:center",
    "padding:8px 20px", "overflow:hidden", "white-space:nowrap",
  ].join(";");
  return `<div class="tanaghom-badge" data-node="${escapeHtml(node.id)}" dir="${direction}" style="${style}">${escapeHtml(node.text ?? "")}</div>`;
}

function renderImageNode(node, assets) {
  const asset = assets.get(node.asset_version_id);
  if (!asset) throw new Error("invalid_design_document:unresolved_asset_ref");
  const style = [
    `left:${node.x}px`, `top:${node.y}px`, `width:${node.width}px`, `height:${node.height}px`,
    `border-radius:${node.corner_radius ?? 0}px`,
    "position:absolute", "object-fit:cover",
  ].join(";");
  return `<img class="tanaghom-image" data-node="${escapeHtml(node.id)}" alt="" src="data:${asset.mime};base64,${asset.bytes.toString("base64")}" style="${style}" />`;
}

// assets: Map(asset_version_id -> { bytes: Buffer, mime }). Backgrounds may
// also resolve through the same map. options: { fontCss, fontFamily }.
export function renderNodeHtml(node, direction, assets) {
  if (node.type === "text") return renderTextNode(node, direction);
  if (node.type === "image") return renderImageNode(node, assets);
  if (node.type === "shape") return renderShapeNode(node);
  return renderBadgeNode(node, direction);
}

export function pageBackgroundHtml(doc, assets) {
  const background = doc.background ?? {};
  const backgroundStyle = `background:${background.color ?? "#ffffff"};`;
  let backgroundImage = "";
  if (background.image_version_id) {
    const asset = assets.get(background.image_version_id);
    if (!asset) throw new Error("invalid_design_document:unresolved_background_ref");
    backgroundImage = `<img class="tanaghom-bg" alt="" src="data:${asset.mime};base64,${asset.bytes.toString("base64")}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" />`;
  }
  return { backgroundStyle, backgroundImage };
}

export function pageShellHtml({ doc, canvas, fontCss = "", fontFamily = "Cairo", bodyHtml, extraCss = "" }) {
  return `<!DOCTYPE html><html lang="${doc.locale}" dir="${doc.direction}"><head><meta charset="utf-8" /><style>${fontCss}*{margin:0;padding:0;box-sizing:border-box;}html,body{width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;background:#fff;font-family:${fontFamily},'Segoe UI',Tahoma,Arial,sans-serif;}body{position:relative;${bodyHtml.backgroundStyle}}${extraCss}</style></head><body>${bodyHtml.backgroundImage}${bodyHtml.nodesHtml}</body></html>`;
}

export function buildPageHtml({ doc, pageId, assets, fontCss = "", fontFamily = "Cairo" }) {
  const { pages, canvas } = validateDocument(doc);
  const page = (doc.kind === "carousel" ? doc.pages : [{ id: "page-1", nodes: doc.nodes }]).find((candidate) => candidate.id === pageId);
  if (!page) throw new Error("invalid_design_document:unknown_page");
  const background = pageBackgroundHtml(doc, assets);
  const nodes = page.nodes.map((node) => renderNodeHtml(node, doc.direction, assets)).join("");
  void pages;
  return pageShellHtml({ doc, canvas, fontCss, fontFamily, bodyHtml: { ...background, nodesHtml: nodes } });
}

export function buildDocumentHtml({ doc, assets, fontCss = "", fontFamily = "Cairo" }) {
  const { pages } = validateDocument(doc);
  const ids = doc.kind === "carousel" ? doc.pages.map((page) => page.id) : ["page-1"];
  void pages;
  return ids.map((pageId) => ({ pageId, html: buildPageHtml({ doc, pageId, assets, fontCss, fontFamily }) }));
}

export function bundledFontCss(fontDir) {
  const root = fontDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts");
  const bytes = readFileSync(path.join(root, "Cairo.ttf"));
  return `@font-face{font-family:'Cairo';src:url(data:font/ttf;base64,${bytes.toString("base64")}) format('truetype');font-weight:100 900;font-style:normal;font-display:swap;}`;
}
