// Deterministic motion timeline renderer (P3). Pure functions, zero
// dependencies: validates a motion document against its pinned design
// document and emits one self-contained, JavaScript-free HTML string per
// frame. Freezing is exact, not timed: every CSS animation is emitted
// with `animation-delay` shifted by the frame time and
// `animation-play-state: paused`, so frame t is byte-deterministic and
// independent of wall-clock, load order, or compositor state.
// Logical directions (start/end) resolve against the document direction,
// so entrances stay RTL-correct for Arabic.
import {
  escapeHtml,
  pageBackgroundHtml,
  pageShellHtml,
  renderNodeHtml,
  validateDocument,
} from "./document.mjs";

export const MOTION_FPS = Object.freeze([24, 30]);
export const MOTION_MAX_TOTAL_MS = 30000;
export const MOTION_MAX_FRAMES = 900;
export const MOTION_PRESETS = Object.freeze(["none", "fade", "slide", "scale", "reveal"]);
export const MOTION_TRANSITIONS = Object.freeze(["none", "fade", "slide", "scale"]);
export const MOTION_DIRECTIONS = Object.freeze(["up", "down", "start", "end"]);
export const MOTION_EASINGS = Object.freeze(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);
const SLIDE_OFFSET_PX = 120;

function fail(message) {
  throw new Error(`invalid_motion_document:${message}`);
}

function checkInt(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label}_bounds`);
}

export function physicalDirection(logical, direction) {
  if (logical === "up" || logical === "down") return logical;
  if (logical === "start") return direction === "rtl" ? "right" : "left";
  if (logical === "end") return direction === "rtl" ? "left" : "right";
  fail("motion_direction");
}

function slideOffset(physical) {
  if (physical === "up") return "0px, 120px";
  if (physical === "down") return "0px, -120px";
  if (physical === "left") return "-120px, 0px";
  return "120px, 0px";
}

function revealInset(physical) {
  if (physical === "up") return "100% 0px 0px 0px";
  if (physical === "down") return "0px 0px 100% 0px";
  if (physical === "left") return "0px 100% 0px 0px";
  return "0px 0px 0px 100%";
}

// Keyframe endpoints per preset. `to` is always the natural style, so a
// finished animation is pixel-identical to the static design.
export function keyframesFor(preset, physical) {
  if (preset === "fade") {
    return { from: "opacity:0;", to: "opacity:1;" };
  }
  if (preset === "slide") {
    return {
      from: `opacity:0;transform:translate(${slideOffset(physical)});`,
      to: "opacity:1;transform:none;",
    };
  }
  if (preset === "scale") {
    return {
      from: "opacity:0;transform:scale(0.6);",
      to: "opacity:1;transform:scale(1);",
    };
  }
  if (preset === "reveal") {
    return {
      from: `opacity:0;clip-path:inset(${revealInset(physical)});`,
      to: "opacity:1;clip-path:inset(0px);",
    };
  }
  fail("motion_preset");
}

function designPages(designDoc) {
  if (designDoc.kind === "carousel") return designDoc.pages;
  return [{ id: "page-1", kind: "body", nodes: designDoc.nodes }];
}

export function validateMotion(doc, designDoc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail("document_shape");
  if (doc.kind !== "motion") fail("document_kind");
  if (doc.locale !== "ar" && doc.locale !== "en") fail("document_locale");
  if (doc.direction !== "rtl" && doc.direction !== "ltr") fail("document_direction");
  if (!MOTION_FPS.includes(doc.fps)) fail("fps_allowlist");
  validateDocument(designDoc);
  if (doc.locale !== designDoc.locale || doc.direction !== designDoc.direction) fail("locale_direction_design_mismatch");
  if (doc.canvas !== undefined) {
    if (doc.canvas.width !== designDoc.canvas.width || doc.canvas.height !== designDoc.canvas.height) {
      fail("canvas_design_mismatch");
    }
  }
  const pages = designPages(designDoc);
  const pageById = new Map(pages.map((page) => [page.id, page]));
  if (!Array.isArray(doc.scenes) || doc.scenes.length < 1 || doc.scenes.length > 10) fail("scene_count");
  const seenScenes = new Set();
  let totalMs = 0;
  for (const scene of doc.scenes) {
    if (!scene || typeof scene !== "object") fail("scene_shape");
    if (typeof scene.id !== "string" || scene.id.length < 1 || scene.id.length > 80) fail("scene_id");
    if (seenScenes.has(scene.id)) fail("duplicate_scene_id");
    seenScenes.add(scene.id);
    if (!pageById.has(scene.page_id)) fail("scene_page_unknown");
    checkInt(scene.duration_ms, 500, 10000, "scene_duration");
    totalMs += scene.duration_ms;
    const transition = scene.transition ?? { preset: "none" };
    if (!MOTION_TRANSITIONS.includes(transition.preset)) fail("transition_preset");
    if (transition.direction !== undefined && !MOTION_DIRECTIONS.includes(transition.direction)) fail("transition_direction");
    if (transition.duration_ms !== undefined) checkInt(transition.duration_ms, 200, 2000, "transition_duration");
    for (const key of Object.keys(scene)) {
      if (!["id", "page_id", "duration_ms", "transition"].includes(key)) fail(`unknown_scene_property:${key}`);
    }
  }
  if (totalMs > MOTION_MAX_TOTAL_MS) fail("total_duration");
  if (!Array.isArray(doc.elements) || doc.elements.length < 1 || doc.elements.length > 48) fail("element_count");
  const nodeIds = new Set();
  for (const page of pages) for (const node of page.nodes) nodeIds.add(node.id);
  for (const element of doc.elements) {
    if (!element || typeof element !== "object") fail("element_shape");
    if (!nodeIds.has(element.node_id)) fail("element_node_unknown");
    if (!MOTION_PRESETS.includes(element.preset)) fail("element_preset");
    if (element.direction !== undefined && !MOTION_DIRECTIONS.includes(element.direction)) fail("element_direction");
    if (element.delay_ms !== undefined) checkInt(element.delay_ms, 0, MOTION_MAX_TOTAL_MS, "element_delay");
    if (element.duration_ms !== undefined) checkInt(element.duration_ms, 200, 10000, "element_duration");
    if (element.easing !== undefined && !MOTION_EASINGS.includes(element.easing)) fail("element_easing");
    if (element.scene_id !== undefined) {
      if (!seenScenes.has(element.scene_id)) fail("element_scene_unknown");
      const scene = doc.scenes.find((candidate) => candidate.id === element.scene_id);
      const sceneNodes = new Set(pageById.get(scene.page_id).nodes.map((node) => node.id));
      if (!sceneNodes.has(element.node_id)) fail("element_node_not_in_scene");
    }
    for (const key of Object.keys(element)) {
      if (!["node_id", "scene_id", "preset", "direction", "delay_ms", "duration_ms", "easing"].includes(key)) {
        fail(`unknown_element_property:${key}`);
      }
    }
  }
  if (doc.captions !== undefined) {
    if (!Array.isArray(doc.captions) || doc.captions.length > 12) fail("caption_count");
    for (const caption of doc.captions) {
      if (!caption || typeof caption !== "object") fail("caption_shape");
      if (typeof caption.text !== "string" || caption.text.length < 1 || caption.text.length > 280) fail("caption_text");
      checkInt(caption.start_ms, 0, MOTION_MAX_TOTAL_MS, "caption_start");
      checkInt(caption.end_ms, 1, MOTION_MAX_TOTAL_MS, "caption_end");
      if (caption.end_ms <= caption.start_ms) fail("caption_range");
      if (caption.end_ms > totalMs) fail("caption_beyond_timeline");
      for (const key of Object.keys(caption)) {
        if (!["text", "start_ms", "end_ms"].includes(key)) fail(`unknown_caption_property:${key}`);
      }
    }
  }
  const totalFrames = Math.round((totalMs * doc.fps) / 1000);
  if (totalFrames < 1 || totalFrames > MOTION_MAX_FRAMES) fail("frame_count");
  return { totalMs, totalFrames, fps: doc.fps };
}

export function planTimeline(doc, designDoc) {
  const { totalMs, totalFrames, fps } = validateMotion(doc, designDoc);
  let cursor = 0;
  const scenes = doc.scenes.map((scene, index) => {
    const planned = {
      index,
      id: scene.id,
      pageId: scene.page_id,
      startMs: cursor,
      durationMs: scene.duration_ms,
      transition: scene.transition ?? { preset: "none" },
    };
    cursor += scene.duration_ms;
    return planned;
  });
  return { totalMs, totalFrames, fps, scenes };
}

function sceneAtTime(scenes, t) {
  for (let index = scenes.length - 1; index >= 0; index -= 1) {
    if (t >= scenes[index].startMs) return scenes[index];
  }
  return scenes[0];
}

function elementsForScene(doc, scene, pageNodeIds) {
  return doc.elements.filter((element) => {
    if (!pageNodeIds.has(element.node_id)) return false;
    if (element.scene_id !== undefined) return element.scene_id === scene.id;
    return true;
  });
}

// Frozen animation rule: shifting the delay by the frame time while paused
// pins the animation at exactly frame t. Unstarted animations show their
// `from` state, finished ones their `to` state — matching live playback.
function frozenRule(selector, name, delayMs, durationMs, easing, t) {
  const shift = Math.max(0, t - delayMs);
  return `${selector}{animation:${name} ${durationMs}ms ${easing} 0ms 1 normal both paused;animation-delay:-${shift}ms;}`;
}

function liveRule(selector, name, delayMs, durationMs, easing) {
  return `${selector}{animation:${name} ${durationMs}ms ${easing} ${delayMs}ms 1 normal both;}`;
}

export function buildMotionFrameHtml({ motion, designDoc, assets, fontCss = "", fontFamily = "Cairo", t = null }) {
  const plan = planTimeline(motion, designDoc);
  const live = t === null;
  const frameT = live ? 0 : Math.max(0, Math.min(t, plan.totalMs - 1));
  const scene = live ? plan.scenes[0] : sceneAtTime(plan.scenes, frameT);
  const pages = designPages(designDoc);
  const page = pages.find((candidate) => candidate.id === scene.pageId);
  const background = pageBackgroundHtml(designDoc, assets);
  const pageNodeIds = new Set(page.nodes.map((node) => node.id));
  const animated = elementsForScene(motion, scene, pageNodeIds);
  const elementByNode = new Map();
  for (const element of animated) {
    if (!elementByNode.has(element.node_id)) elementByNode.set(element.node_id, element);
  }
  let css = "";
  let keyIndex = 0;
  const keyNames = new Map();
  function keyframes(preset, direction) {
    const key = `${preset}:${direction}`;
    if (!keyNames.has(key)) {
      const physical = physicalDirection(direction, motion.direction);
      const ends = keyframesFor(preset, physical);
      const name = `tmg${keyIndex}`;
      keyIndex += 1;
      css += `@keyframes ${name}{from{${ends.from}}to{${ends.to}}}`;
      keyNames.set(key, name);
    }
    return keyNames.get(key);
  }
  for (const element of elementByNode.values()) {
    if (element.preset === "none") continue;
    const name = keyframes(element.preset, element.direction ?? "up");
    const rule = live
      ? liveRule(`[data-node="${element.node_id}"]`, name, element.delay_ms ?? 0, element.duration_ms ?? 800, element.easing ?? "ease-out")
      : frozenRule(`[data-node="${element.node_id}"]`, name, element.delay_ms ?? 0, element.duration_ms ?? 800, element.easing ?? "ease-out", frameT - scene.startMs);
    css += rule;
  }
  const transition = scene.transition ?? { preset: "none" };
  if (transition.preset !== "none") {
    const name = keyframes(transition.preset === "none" ? "fade" : transition.preset, transition.direction ?? "up");
    const duration = Math.min(transition.duration_ms ?? 600, scene.durationMs);
    const rule = live
      ? liveRule(".tmg-scene", name, 0, duration, "ease-out")
      : frozenRule(".tmg-scene", name, 0, duration, "ease-out", frameT - scene.startMs);
    css += rule;
  }
  const nodesHtml = `<div class="tmg-scene" style="position:absolute;inset:0;">${
    page.nodes.map((node) => renderNodeHtml(node, designDoc.direction, assets)).join("")
  }</div>`;
  let captionsHtml = "";
  if (motion.captions && !live) {
    for (const caption of motion.captions) {
      if (frameT >= caption.start_ms && frameT < caption.end_ms) {
        captionsHtml += `<div class="tmg-caption" dir="${motion.direction}" style="position:absolute;left:90px;right:90px;bottom:90px;background:rgba(15,23,42,0.82);color:#fff;font-size:44px;font-weight:700;text-align:center;padding:20px 28px;border-radius:16px;">${escapeHtml(caption.text)}</div>`;
      }
    }
  }
  const canvas = designDoc.canvas;
  const html = pageShellHtml({
    doc: designDoc, canvas, fontCss, fontFamily,
    bodyHtml: { ...background, nodesHtml: nodesHtml + captionsHtml },
    extraCss: css,
  });
  return { html, plan, sceneIndex: scene.index, frameTimeMs: frameT };
}
