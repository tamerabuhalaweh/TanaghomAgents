/** Cut text at the last word boundary at or before `limit`, never mid-word. */
export function truncateAtWord(value: string, limit: number): string {
  const text = value ?? "";
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const boundary = Math.max(
    slice.lastIndexOf(" "),
    slice.lastIndexOf("\n"),
    slice.lastIndexOf("\u00a0"),
    slice.lastIndexOf("\t"),
  );
  const cut = boundary > limit * 0.5 ? slice.slice(0, boundary) : slice;
  return cut.replace(/[\s,;:.،؛:–—-]+$/u, "").trimEnd();
}

// Inline markers the deliverable parser understands, longest first so a `**`
// pair is never read as two single asterisks.
const INLINE_MARKERS = ["***", "**", "__", "`", "*"];

/**
 * Remove inline markers that a cut left open. An excerpt can end in the middle
 * of a **bold** span; the parser would then render that dangling opener as
 * literal asterisks, so it is dropped instead of closed — closing it would put
 * the ellipsis inside the emphasis and change the meaning of the source.
 */
export function balanceInlineMarkdown(value: string): string {
  const text = value ?? "";
  let output = "";
  let index = 0;
  while (index < text.length) {
    const marker = INLINE_MARKERS.find((candidate) => text.startsWith(candidate, index));
    if (!marker) {
      output += text[index];
      index += 1;
      continue;
    }
    const close = text.indexOf(marker, index + marker.length);
    if (close === -1) {
      // No closing partner: this is the marker the truncation cut in half.
      index += marker.length;
      continue;
    }
    output += text.slice(index, close + marker.length);
    index = close + marker.length;
  }
  return output.trimEnd();
}

/** Word-boundary truncation that never leaves a dangling inline markdown marker. */
export function truncateMarkdownAtWord(value: string, limit: number): string {
  return balanceInlineMarkdown(truncateAtWord(value, limit));
}
