import type { DesignDocument, RenderAsset } from "./document";

export interface MotionSceneTransition {
  preset: "none" | "fade" | "slide" | "scale";
  direction?: "up" | "down" | "start" | "end";
  duration_ms?: number;
}

export interface MotionScene {
  id: string;
  page_id: string;
  duration_ms: number;
  transition?: MotionSceneTransition;
}

export interface MotionElement {
  node_id: string;
  scene_id?: string;
  preset: "none" | "fade" | "slide" | "scale" | "reveal";
  direction?: "up" | "down" | "start" | "end";
  delay_ms?: number;
  duration_ms?: number;
  easing?: "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface MotionCaption {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface MotionDocument {
  kind: "motion";
  locale: "ar" | "en";
  direction: "rtl" | "ltr";
  design_template_id: string;
  design_version: number;
  design_page_id?: string;
  fps: 24 | 30;
  canvas?: { width: 1080; height: 1080 | 1350 | 1920 };
  scenes: MotionScene[];
  elements: MotionElement[];
  captions?: MotionCaption[];
}

export interface PlannedScene {
  index: number;
  id: string;
  pageId: string;
  startMs: number;
  durationMs: number;
  transition: MotionSceneTransition;
}

export interface MotionPlan {
  totalMs: number;
  totalFrames: number;
  fps: number;
  scenes: PlannedScene[];
}

export function validateMotion(doc: unknown, designDoc: DesignDocument): { totalMs: number; totalFrames: number; fps: number };
export function planTimeline(doc: MotionDocument, designDoc: DesignDocument): MotionPlan;
export function physicalDirection(logical: string, direction: "rtl" | "ltr"): string;
export function buildMotionFrameHtml(args: {
  motion: MotionDocument;
  designDoc: DesignDocument;
  assets: Map<string, RenderAsset>;
  fontCss?: string;
  fontFamily?: string;
  t?: number | null;
}): { html: string; plan: MotionPlan; sceneIndex: number; frameTimeMs: number };
