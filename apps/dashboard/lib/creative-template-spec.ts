export const TEMPLATE_FORMATS = ["1:1", "4:5", "9:16"] as const;
export type TemplateFormat = (typeof TEMPLATE_FORMATS)[number];
export type TemplateKind = "ad" | "carousel" | "motion" | "landing" | "caption";

export interface GuidedTemplateInput {
  kind: Exclude<TemplateKind, "motion">;
  locale: "en" | "ar";
  format: TemplateFormat;
  headline: string;
  body?: string;
  cta?: string;
  backgroundColor?: string;
}

const CANVAS_SIZES: Record<TemplateFormat, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function normalizeHexColor(value: string | undefined, fallback = "#FFFFFF"): string {
  const trimmed = (value ?? "").trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toUpperCase() : fallback;
}

function readableInk(backgroundHex: string): string {
  const r = Number.parseInt(backgroundHex.slice(1, 3), 16);
  const g = Number.parseInt(backgroundHex.slice(3, 5), 16);
  const b = Number.parseInt(backgroundHex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.55 ? "#FFFFFF" : "#101828";
}

/**
 * Builds a backend-valid Creative Template spec from guided form inputs so
 * workspace owners never have to hand-write raw JSON schemas.
 */
export function buildTemplateSpec(input: GuidedTemplateInput): Record<string, unknown> {
  const locale = input.locale === "ar" ? "ar" : "en";
  const direction = locale === "ar" ? "rtl" : "ltr";
  const headline = input.headline.trim();
  const body = (input.body ?? "").trim();
  const cta = (input.cta ?? "").trim();
  const canvas = CANVAS_SIZES[input.format] ?? CANVAS_SIZES["1:1"];
  const bg = normalizeHexColor(input.backgroundColor, "#FFFFFF");
  const ink = readableInk(bg);

  if (input.kind === "ad") {
    const headlineHeight = Math.round(canvas.height * 0.24);
    const bodyY = 120 + headlineHeight + 40;
    const bodyHeight = Math.round(canvas.height * 0.22);
    const ctaY = Math.min(canvas.height - 190, bodyY + bodyHeight + 60);
    const nodes: Array<Record<string, unknown>> = [
      {
        id: "headline-1",
        type: "text",
        role: "headline",
        x: 90,
        y: 120,
        width: 900,
        height: headlineHeight,
        text: headline,
        font_size: 72,
        font_weight: 800,
        align: "start",
        color: ink,
      },
    ];
    if (body) {
      nodes.push({
        id: "body-1",
        type: "text",
        role: "body",
        x: 90,
        y: bodyY,
        width: 900,
        height: bodyHeight,
        text: body,
        font_size: 38,
        font_weight: 400,
        align: "start",
        color: ink,
      });
    }
    if (cta) {
      nodes.push({
        id: "cta-1",
        type: "badge",
        role: "cta",
        x: 90,
        y: ctaY,
        width: 460,
        height: 108,
        text: cta,
        font_size: 34,
        font_weight: 700,
        align: "center",
        color: "#FFFFFF",
        background_color: "#0F766E",
        corner_radius: 18,
      });
    }
    return {
      contract_version: "creative.ad-document.v1",
      kind: "ad",
      locale,
      direction,
      canvas,
      background: { color: bg },
      nodes,
    };
  }

  if (input.kind === "carousel") {
    const slideTwoNodes: Array<Record<string, unknown>> = [
      {
        id: "body-1",
        type: "text",
        role: "body",
        x: 90,
        y: 180,
        width: 900,
        height: Math.round(canvas.height * 0.34),
        text: body || headline,
        font_size: 46,
        font_weight: 500,
        align: "start",
        color: ink,
      },
    ];
    if (cta) {
      slideTwoNodes.push({
        id: "cta-1",
        type: "badge",
        role: "cta",
        x: 90,
        y: Math.min(canvas.height - 200, 720),
        width: 460,
        height: 108,
        text: cta,
        font_size: 34,
        font_weight: 700,
        align: "center",
        color: "#FFFFFF",
        background_color: "#0F766E",
        corner_radius: 18,
      });
    }
    return {
      contract_version: "creative.carousel-document.v1",
      kind: "carousel",
      locale,
      direction,
      canvas,
      background: { color: bg },
      pages: [
        {
          id: "slide-1",
          kind: "cover",
          nodes: [
            {
              id: "headline-1",
              type: "text",
              role: "headline",
              x: 90,
              y: 180,
              width: 900,
              height: Math.round(canvas.height * 0.34),
              text: headline,
              font_size: 74,
              font_weight: 800,
              align: "start",
              color: ink,
            },
          ],
        },
        {
          id: "slide-2",
          kind: "end",
          nodes: slideTwoNodes,
        },
      ],
    };
  }

  return {
    kind: input.kind,
    locale,
    direction,
    headline,
    ...(body ? { body } : {}),
    ...(cta ? { cta } : {}),
  };
}
