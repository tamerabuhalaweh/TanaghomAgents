/**
 * Normalizes a heading or deliverable label for comparison across numbered,
 * markdown-formatted, and parenthetical bilingual variants, e.g.:
 * "### 1. تحليل الاستراتيجية وصوت العلامة التجارية (Tanaghom Content Strategy)"
 * -> "تحليل الاستراتيجية وصوت العلامة التجارية".
 */
export function normalizeHeadingText(line: string): string {
  let text = line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/\*/g, "")
    .replace(/^\d+[.)]\s*/, "");

  while (/\([^()]*\)/.test(text)) {
    text = text.replace(/\s*\([^()]*\)/g, " ");
  }

  return text
    .replace(/[:：]\s*$/, "")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function headingInfo(
  line: string,
  lineIndex: number,
  labelKeys: Set<string>,
): { level: number; key: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const atx = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (atx) {
    const key = normalizeHeadingText(atx[2]);
    return key ? { level: atx[1].length, key } : null;
  }

  // Standalone bold heading line (never a bullet item like "* **Hook:** ...").
  const boldOnly = trimmed.match(/^\*\*([^*\n]+)\*\*\s*[:：]?\s*$/);
  if (boldOnly) {
    const key = normalizeHeadingText(boldOnly[1]);
    return key ? { level: 4, key } : null;
  }

  if (lineIndex === 0) {
    const key = normalizeHeadingText(trimmed);
    if (key && labelKeys.has(key)) return { level: 1, key };
  }

  return null;
}

/**
 * Drops duplicate section/deliverable headings from a full deliverable view:
 * 1) Any heading repeating the visible card label (`labels`)
 * 2) Headings already rendered immediately above in `excerpt`
 * 3) Repeated headings at the same heading level inside the document itself
 *    (preserving legitimate repeated child headings such as "### English Copy"
 *    under distinct parent posts "## Post 2", "## Post 3").
 */
export function withoutDuplicateHeading(
  document: string,
  labels: Array<string | undefined>,
  excerpt?: string,
): string {
  if (!document) return document;

  const labelKeys = new Set(
    labels
      .map((label) => (label ? normalizeHeadingText(label) : ""))
      .filter(Boolean),
  );

  const lines = document.split(/\r?\n/);
  const excerptHeadingQueue: string[] = [];
  if (excerpt) {
    const excerptLines = excerpt.split(/\r?\n/);
    for (let i = 0; i < excerptLines.length; i += 1) {
      const info = headingInfo(excerptLines[i], i, labelKeys);
      if (!info || labelKeys.has(info.key)) continue;
      // Preserve a trailing heading that truncateMarkdownAtWord cut mid-title
      // so the complete heading remains visible inside the expanded view.
      if (i === excerptLines.length - 1 && i < lines.length) {
        const docInfo = headingInfo(lines[i], i, labelKeys);
        if (docInfo && docInfo.key !== info.key) continue;
      }
      excerptHeadingQueue.push(info.key);
    }
  }

  const seenByLevel = new Map<number, Set<string>>();
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const info = headingInfo(line, i, labelKeys);
    if (!info) {
      kept.push(line);
      continue;
    }

    if (labelKeys.has(info.key)) {
      continue;
    }

    if (excerptHeadingQueue.length > 0 && info.key === excerptHeadingQueue[0]) {
      excerptHeadingQueue.shift();
      let levelSet = seenByLevel.get(info.level);
      if (!levelSet) {
        levelSet = new Set<string>();
        seenByLevel.set(info.level, levelSet);
      }
      levelSet.add(info.key);
      for (const deeper of seenByLevel.keys()) {
        if (deeper > info.level) seenByLevel.delete(deeper);
      }
      continue;
    }

    const seenAtLevel = seenByLevel.get(info.level);
    if (seenAtLevel?.has(info.key)) {
      continue;
    }

    let nextLevelSet = seenAtLevel;
    if (!nextLevelSet) {
      nextLevelSet = new Set<string>();
      seenByLevel.set(info.level, nextLevelSet);
    }
    nextLevelSet.add(info.key);
    for (const deeper of seenByLevel.keys()) {
      if (deeper > info.level) seenByLevel.delete(deeper);
    }

    kept.push(line);
  }

  const cleaned = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");

  return cleaned || document;
}
