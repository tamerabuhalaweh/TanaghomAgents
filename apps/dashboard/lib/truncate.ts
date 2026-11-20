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
