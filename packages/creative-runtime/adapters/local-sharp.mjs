// Deterministic CPU image pipeline (sharp). Real pixel operations, no
// model weights, no network, no credentials: scene composition over
// preset backgrounds, relight-lite modulation, and enhance/upscale.
// Every parameter is bounded and recorded in provenance for audit.
import sharp from "sharp";

const MAX_DIMENSION = 2048;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;

function assertImageInput(bytes, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error(`${label}_bytes_required`);
  if (bytes.length > MAX_INPUT_BYTES) throw new Error(`${label}_too_large`);
}

function hexToRgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) throw new Error("invalid_preset_color");
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export async function renderBackground({ kind, color, from, to, angle = 135, width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error("invalid_scene_dimensions");
  }
  if (kind === "solid") {
    return sharp({ create: { width, height, channels: 3, background: hexToRgb(color) } }).png().toBuffer();
  }
  if (kind === "gradient") {
    const a = hexToRgb(from);
    const b = hexToRgb(to);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${angle} 0.5 0.5)">` +
      `<stop offset="0" stop-color="rgb(${a.r},${a.g},${a.b})"/>` +
      `<stop offset="1" stop-color="rgb(${b.r},${b.g},${b.b})"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    return sharp(Buffer.from(svg), { limitInputPixels: 80_000_000 }).png().toBuffer();
  }
  throw new Error(`unsupported_background_kind:${kind}`);
}

// Composite a foreground (alpha-bearing PNG/JPEG/WebP) onto a preset scene
// with relight-lite modulation. Returns validated PNG bytes + provenance.
export async function composeScene({ foregroundBytes, preset, mime = "image/png" }) {
  assertImageInput(foregroundBytes, "foreground");
  if (!preset || typeof preset !== "object") throw new Error("preset_required");
  const { width, height } = preset.output ?? {};
  const background = await renderBackground({ ...(preset.background ?? { kind: "solid", color: "#ffffff" }), width, height });
  const relight = preset.relight ?? {};
  const brightness = typeof relight.brightness === "number" ? relight.brightness : 1;
  const saturation = typeof relight.saturation === "number" ? relight.saturation : 1;
  if (!(brightness > 0 && brightness <= 3) || !(saturation >= 0 && saturation <= 3)) throw new Error("invalid_relight_params");
  const foreground = await sharp(foregroundBytes, { limitInputPixels: 80_000_000 })
    .ensureAlpha()
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .modulate({ brightness, saturation })
    .png()
    .toBuffer();
  const composed = await sharp(background)
    .composite([{ input: foreground, gravity: "centre" }])
    .png()
    .toBuffer();
  return {
    bytes: composed,
    mime: "image/png",
    width,
    height,
    provenance: {
      adapter: "local-sharp",
      operation: "compose",
      preset: preset.code ?? null,
      background: preset.background ?? null,
      relight: { brightness, saturation },
      source_mime: mime,
    },
  };
}

// Enhance: bounded upscale + mild sharpen. Kernel recorded in provenance.
export async function enhanceImage({ bytes, scale = 2, sharpenSigma = 0.8 }) {
  assertImageInput(bytes, "enhance");
  if (![1, 2, 4].includes(scale)) throw new Error("invalid_enhance_scale");
  if (typeof sharpenSigma !== "number" || sharpenSigma < 0 || sharpenSigma > 3) throw new Error("invalid_sharpen");
  const meta = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata();
  const width = Math.min((meta.width ?? 0) * scale, MAX_DIMENSION);
  const height = Math.min((meta.height ?? 0) * scale, MAX_DIMENSION);
  if (!width || !height) throw new Error("unreadable_image");
  const out = await sharp(bytes, { limitInputPixels: 80_000_000 })
    .resize(width, height, { kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: sharpenSigma })
    .png()
    .toBuffer();
  return {
    bytes: out, mime: "image/png", width, height,
    provenance: { adapter: "local-sharp", operation: "enhance", scale, kernel: "lanczos3", sharpen_sigma: sharpenSigma },
  };
}

export async function probeImage(bytes) {
  assertImageInput(bytes, "probe");
  const meta = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata();
  if (!meta.width || !meta.height || !meta.format) throw new Error("unreadable_image");
  return { width: meta.width, height: meta.height, format: meta.format, hasAlpha: !!meta.hasAlpha, exifPresent: !!meta.exif };
}

export const localSharpAdapter = Object.freeze({
  name: "local-sharp",
  capabilities: Object.freeze(["image", "edit"]),
  async execute({ operation, ...input }) {
    if (operation === "compose") return composeScene(input);
    if (operation === "enhance") return enhanceImage(input);
    throw new Error(`unsupported_local_operation:${operation}`);
  },
});
