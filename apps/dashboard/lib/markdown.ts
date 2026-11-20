// Deliverables are stored as markdown. This parser turns that source into plain
// data that React renders as elements, so model output is never injected as HTML.

export type MarkdownInline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "em"; value: string }
  | { type: "strong_em"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

export type MarkdownBlock =
  | { type: "heading"; level: number; inline: MarkdownInline[] }
  | { type: "paragraph"; inline: MarkdownInline[] }
  | { type: "list"; ordered: boolean; items: MarkdownInline[][] }
  | { type: "quote"; inline: MarkdownInline[] }
  | { type: "code"; value: string }
  | { type: "rule" };

const INLINE_TOKEN = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\([^)\s]+\))/;
const LINK_TOKEN = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const BLOCK_START = /^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s+|\*{3,}$|-{3,}$|_{3,}$)/;

export function safeMarkdownHref(href: string): string | null {
  const value = href.trim();
  if (/^(https?:\/\/|mailto:)/i.test(value)) return value;
  if (/^(\/|#)/.test(value)) return value;
  return null;
}

/**
 * Excerpts written before the generator fix can start with one asterisk fewer
 * than their closing pair ("*Opening:**"); restore the missing opener so the
 * span renders as bold text instead of leaking a literal asterisk.
 */
function repairLegacyBold(value: string): string {
  return value.split("\n").map((line) => line.replace(/(^|\s)\*([^*\n]+?)\*\*/g, "$1**$2**")).join("\n");
}

/** Drops a marker left without a partner, so "*…" renders as "…". */
function stripDanglingMarkers(value: string): string {
  let text = value;
  for (const marker of ["**", "*"]) {
    while ((text.split(marker).length - 1) % 2 === 1) {
      const at = text.lastIndexOf(marker);
      if (at < 0) break;
      text = `${text.slice(0, at)}${text.slice(at + marker.length)}`;
    }
  }
  return text;
}

export function parseMarkdownInline(source: string): MarkdownInline[] {
  const value = repairLegacyBold(source);
  const parts = value.split(INLINE_TOKEN);
  const nodes: MarkdownInline[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 6 && part.startsWith("***") && part.endsWith("***")) {
      nodes.push({ type: "strong_em", value: part.slice(3, -3).trim() });
      continue;
    }
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      nodes.push({ type: "strong", value: part.slice(2, -2).trim() });
      continue;
    }
    if (part.length > 4 && part.startsWith("__") && part.endsWith("__")) {
      nodes.push({ type: "strong", value: part.slice(2, -2).trim() });
      continue;
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      nodes.push({ type: "code", value: part.slice(1, -1) });
      continue;
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      nodes.push({ type: "em", value: part.slice(1, -1).trim() });
      continue;
    }
    const link = part.match(LINK_TOKEN);
    if (link) {
      const href = safeMarkdownHref(link[2]);
      if (href) {
        nodes.push({ type: "link", value: link[1], href });
        continue;
      }
      nodes.push({ type: "text", value: link[1] });
      continue;
    }
    const text = stripDanglingMarkers(part);
    if (text) nodes.push({ type: "text", value: text });
  }
  return nodes;
}

function stripClosingHashes(value: string): string {
  return value.replace(/\s+#+\s*$/, "").trim();
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trimEnd();
    if (!line.trim()) {
      index += 1;
      continue;
    }

    // A marker-only line ("*…", "**") is the tail of an interrupted span, not content.
    if (/^(?:\*{1,2}|_{1,2})\s*(?:…|\.\.\.)?$/.test(line.trim())) {
      index += 1;
      continue;
    }

    if (/^```/.test(line.trim())) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", value: body.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        inline: parseMarkdownInline(stripClosingHashes(heading[2])),
      });
      index += 1;
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^>\s?/, "").trim());
        index += 1;
      }
      blocks.push({ type: "quote", inline: parseMarkdownInline(quoted.join(" ")) });
      continue;
    }

    const listItem = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (listItem) {
      const ordered = /^\d/.test(listItem[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index].trimEnd();
        const item = candidate.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (item) {
          if (/^\d/.test(item[1]) !== ordered) break;
          items.push(item[2]);
          index += 1;
          continue;
        }
        if (!candidate.trim()) break;
        if (/^(#{1,6}\s|```|>)/.test(candidate)) break;
        // A plain continuation line belongs to the item above it.
        if (items.length) items[items.length - 1] = `${items[items.length - 1]} ${candidate.trim()}`;
        index += 1;
      }
      blocks.push({ type: "list", ordered, items: items.map(parseMarkdownInline) });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const candidate = lines[index].trimEnd();
      if (!candidate.trim()) break;
      if (BLOCK_START.test(candidate.trim())) break;
      paragraph.push(candidate.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", inline: parseMarkdownInline(paragraph.join(" ")) });
  }

  return blocks;
}

/** Markdown source reduced to its readable text, useful for accessible labels. */
export function markdownToPlainText(source: string): string {
  const blocks = parseMarkdown(source);
  return blocks.map((block) => {
    if (block.type === "heading" || block.type === "paragraph" || block.type === "quote") {
      return inlineToText(block.inline);
    }
    if (block.type === "list") return block.items.map(inlineToText).join(" ");
    if (block.type === "code") return block.value;
    return "";
  }).filter(Boolean).join("\n");
}

function inlineToText(nodes: MarkdownInline[]): string {
  return nodes.map((node) => node.value).join("");
}
