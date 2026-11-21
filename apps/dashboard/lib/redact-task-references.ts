// Render/export-time redaction of stored task-reference UUIDs. Kept free of
// React so the test suite executes the same code the dashboard uses.

const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const HAS_UUID = new RegExp(UUID_SOURCE, "i");
const UUID_GLOBAL = new RegExp(UUID_SOURCE, "gi");
const TASK_REF_LINE = new RegExp(`^(?:[^:\\r\\n]*\\s)?(?:Task reference|مرجع المهمة)\\s*:\\s*${UUID_SOURCE}\\s*$`, "i");
const BARE_NUMBERED_LINE = /^\d+\.\s*$/;

/**
 * Stored executive summaries carry internal task-reference UUIDs. This strips
 * those lines (including a numbered "3. Name" prefix line) and any bare UUID
 * from customer-facing deliverables and exported packs, leaving every other
 * line untouched. Nothing is written back to the API or the database.
 */
export function redactTaskReferences(document: string): string {
  if (!HAS_UUID.test(document) && !/^(?:[^:\r\n]*\s)?(?:Task reference|مرجع المهمة)\s*:/im.test(document)) {
    return document;
  }
  const lines = document.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (TASK_REF_LINE.test(line)) {
      continue;
    }
    if (BARE_NUMBERED_LINE.test(line) && i + 1 < lines.length && TASK_REF_LINE.test(lines[i + 1])) {
      i += 1;
      continue;
    }
    if (HAS_UUID.test(line)) {
      const cleaned = line
        .replace(UUID_GLOBAL, "")
        .replace(/[ \t]{2,}/g, " ")
        .trimEnd();
      if (cleaned.trim()) kept.push(cleaned);
      continue;
    }
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

