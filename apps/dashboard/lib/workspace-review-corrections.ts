export interface ReviewableStep {
  sequence: number;
  profile_code: string;
  status?: string;
  result?: {
    document?: string;
    [key: string]: unknown;
  } | null;
  document?: string;
  [key: string]: unknown;
}

export interface ReviewCorrectionItem {
  id: string;
  exact: string;
  proposed: string | null;
  action: "replace" | "remove";
  remove_meta_notes: boolean;
  source_label: string;
}

export interface AppliedReviewCorrection {
  step_sequence: number;
  profile_code: string;
  exact: string;
  replacement: string;
  action: "replace" | "remove";
}

export interface WorkspaceReviewCorrectionsSummary {
  has_review: boolean;
  requires_corrections: boolean;
  parsed_count: number;
  applied_count: number;
  applied: AppliedReviewCorrection[];
  unresolved: ReviewCorrectionItem[];
  needs_changes: boolean;
}

const ARABIC_SCRIPT = /[\u0600-\u06ff]/u;
const NEEDS_CORRECTIONS_STATUS = /after applying the corrections above|بعد تطبيق التعديلات أعلاه/iu;
const CLEAN_REVIEW_STATUS = /no corrections needed|لا توجد تعديلات مطلوبة/iu;

const EXACT_LINE = /^\s*(?:[*+\-•]|\d+\.)?\s*\*{0,2}(?:exact\s+passage|draft\s+passage|original\s+passage|المقطع\s+الأصلي|النص\s+الأصلي)[^:：]*[:：]\*{0,2}\s*(.*)$/iu;
const PROPOSED_LINE = /^\s*(?:[*+\-•]|\d+\.)?\s*\*{0,2}(?:proposed\s+(?:revised\s+wording|revision|correction|replacement)|revised\s+wording|corrected\s+(?:passage|wording)|التعديل\s+المقترح|الصياغة\s+المعدّ?لة|التصحيح\s+المقترح)[^:：]*[:：]\*{0,2}\s*(.*)$/iu;
const FIELD_STOP = /^\s*(?:[*+\-•]|\d+\.)?\s*\*{0,2}(?:explanation|supporting|analysis|reason|source\s+fact|missing\s+fact|review\s+status|الشرح|التوضيح|السبب|حالة\s+المراجعة)\b[^:：]*[:：]/iu;
const SUB_LANGUAGE = /^\s*(?:[*+\-•]|\d+\.)?\s*[*_]{0,2}(?:(draft\s+)?(?:arabic(?:\s*\([^)]*\))?|العربية|عربي)|(draft\s+)?(?:english(?:\s*\([^)]*\))?|الإنجليزية|إنجليزي))[*_]{0,2}\s*[:：]\s*[*_]{0,2}\s*(.*)$/iu;

const REMOVE_INSTRUCTION = /^(?:remove|delete|omit|strip|drop)\b|^(?:حذف|إزالة|احذف|أزل)\b/iu;
const META_NOTE_CONTEXT = /parenthetical|meta[- ]?note|meta[- ]?commentary|ملاحظة\s*[:：]|\(note\s*[:：]/iu;
const CUSTOMER_META_NOTE = /\s*\((?:Note|ملاحظة)\s*[:：][^)\n]{4,260}\)\.?(?=\s|$|[.!؟،,])/giu;
const TRUNCATED_META_NOTE = /\s*\((?:Note|ملاحظة)\s*[:：][^)\n]*…/giu;

function stripMarkdownWrappers(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^>\s*/, "").trim();
  value = value.replace(/^`+|`+$/g, "").trim();
  value = value.replace(/^\*{1,2}|\*{1,2}$/g, "").trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const unwrapped = value
      .replace(/^«([\s\S]+)»$/u, "$1")
      .replace(/^["“”]([\s\S]+)["“”]$/u, "$1")
      .replace(/^`([\s\S]+)`$/u, "$1")
      .trim();
    if (unwrapped === value) break;
    value = unwrapped;
  }
  return value.trim();
}

function stripEllipses(value: string): string {
  return value
    .replace(/^(?:\.{2,}|…)+\s*/u, "")
    .replace(/\s*(?:\.{2,}|…)+$/u, "")
    .trim();
}

function collectBlockLines(lines: string[], startIndex: number, inlineValue: string): { values: string[]; nextIndex: number } {
  const values: string[] = [];
  if (inlineValue.trim()) values.push(inlineValue.trim());
  let cursor = startIndex + 1;
  while (cursor < lines.length) {
    const line = lines[cursor];
    const trimmed = line.trim();
    if (!trimmed) {
      if (values.length > 0) break;
      cursor += 1;
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed) || /^[-=_]{3,}$/.test(trimmed)) break;
    if (EXACT_LINE.test(line) || PROPOSED_LINE.test(line) || FIELD_STOP.test(line)) break;
    if (/^\d+\.\s+\*\*/.test(trimmed)) break;
    if (/^>\s*/.test(trimmed) || SUB_LANGUAGE.test(line) || (/^\s+[*+\-•]/.test(line) && !/^\s*[*+\-•]\s*\*\*(?:exact|draft|proposed|supporting|explanation|analysis)/iu.test(line))) {
      values.push(trimmed);
      cursor += 1;
      continue;
    }
    if (values.length === 0) {
      values.push(trimmed);
      cursor += 1;
      continue;
    }
    break;
  }
  return { values, nextIndex: cursor - 1 };
}

function splitVariants(rawValues: string[]): { arabic: string[]; english: string[]; neutral: string[] } {
  const arabic: string[] = [];
  const english: string[] = [];
  const neutral: string[] = [];

  for (const raw of rawValues) {
    const sub = SUB_LANGUAGE.exec(raw);
    if (sub) {
      const cleaned = stripMarkdownWrappers(sub[3] || "");
      if (!cleaned) continue;
      const colonPos = raw.search(/[:：]/u);
      const labelPart = colonPos >= 0 ? raw.slice(0, colonPos) : raw;
      if (/arabic|العربية|عربي/iu.test(labelPart)) arabic.push(cleaned);
      else english.push(cleaned);
      continue;
    }

    // Handle inline bilingual alternatives separated by " / " (e.g. `«...AR...»` / `«...EN...»`).
    const slashParts = raw.split(/\s+\/\s+/u).map(stripMarkdownWrappers).filter(Boolean);
    if (slashParts.length === 2 && ARABIC_SCRIPT.test(slashParts[0]) !== ARABIC_SCRIPT.test(slashParts[1])) {
      for (const part of slashParts) {
        if (ARABIC_SCRIPT.test(part)) arabic.push(part);
        else english.push(part);
      }
      continue;
    }

    const cleaned = stripMarkdownWrappers(raw);
    if (!cleaned) continue;
    neutral.push(cleaned);
  }
  return { arabic, english, neutral };
}

export function parseBrandGuardianCorrections(reviewDocument: string): {
  requires_corrections: boolean;
  items: ReviewCorrectionItem[];
} {
  if (!reviewDocument || typeof reviewDocument !== "string") {
    return { requires_corrections: false, items: [] };
  }
  const normalized = reviewDocument.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const items: ReviewCorrectionItem[] = [];

  let activeHeading = "";
  let pending: {
    exactLines: string[];
    contextLines: string[];
    sourceLabel: string;
  } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed) || /^\d+\.\s+\*\*/.test(trimmed)) {
      activeHeading = trimmed;
    }

    const exactMatch = EXACT_LINE.exec(line);
    if (exactMatch) {
      const collected = collectBlockLines(lines, index, exactMatch[1] || "");
      pending = {
        exactLines: collected.values,
        contextLines: [activeHeading, trimmed, ...collected.values],
        sourceLabel: activeHeading || trimmed.slice(0, 80),
      };
      index = collected.nextIndex;
      continue;
    }

    const proposedMatch = PROPOSED_LINE.exec(line);
    if (proposedMatch && pending) {
      const collected = collectBlockLines(lines, index, proposedMatch[1] || "");
      index = collected.nextIndex;
      const contextText = [...pending.contextLines, ...collected.values].join("\n");
      const exactVariants = splitVariants(pending.exactLines);
      const proposedVariants = splitVariants(collected.values);

      const joinedProposed = collected.values.map(stripMarkdownWrappers).join(" ").trim();
      const isRemove = REMOVE_INSTRUCTION.test(joinedProposed);
      const isMetaNote = META_NOTE_CONTEXT.test(contextText);

      // Pair exact passages with matching-script proposed revisions.
      const pairs: { exact: string; proposed: string | null }[] = [];
      if (isRemove) {
        const targets = [...exactVariants.arabic, ...exactVariants.english, ...exactVariants.neutral];
        for (const exact of targets) {
          if (exact) pairs.push({ exact, proposed: null });
        }
      } else {
        if (exactVariants.arabic.length && proposedVariants.arabic.length) {
          for (let i = 0; i < exactVariants.arabic.length; i += 1) {
            const exact = exactVariants.arabic[i];
            const proposed = proposedVariants.arabic[i] ?? proposedVariants.arabic[0];
            if (exact && proposed && stripEllipses(exact) !== stripEllipses(proposed)) {
              pairs.push({ exact, proposed });
            }
          }
        }
        if (exactVariants.english.length && proposedVariants.english.length) {
          for (let i = 0; i < exactVariants.english.length; i += 1) {
            const exact = exactVariants.english[i];
            const proposed = proposedVariants.english[i] ?? proposedVariants.english[0];
            if (exact && proposed && stripEllipses(exact) !== stripEllipses(proposed)) {
              pairs.push({ exact, proposed });
            }
          }
        }
        for (const exact of exactVariants.neutral) {
          const isArabic = ARABIC_SCRIPT.test(exact);
          const proposed = isArabic
            ? (proposedVariants.arabic[0] ?? proposedVariants.neutral.find((v) => ARABIC_SCRIPT.test(v)) ?? proposedVariants.neutral[0])
            : (proposedVariants.english[0] ?? proposedVariants.neutral.find((v) => !ARABIC_SCRIPT.test(v)) ?? proposedVariants.neutral[0]);
          if (exact && proposed && stripEllipses(exact) !== stripEllipses(proposed)) {
            pairs.push({ exact, proposed });
          }
        }
      }

      for (const pair of pairs) {
        items.push({
          id: `correction-${items.length + 1}`,
          exact: pair.exact,
          proposed: pair.proposed,
          action: pair.proposed === null ? "remove" : "replace",
          remove_meta_notes: pair.proposed === null && isMetaNote,
          source_label: pending.sourceLabel,
        });
      }
      pending = null;
      continue;
    }

    if (pending && trimmed) {
      pending.contextLines.push(trimmed);
    }
  }

  const explicitlyClean = CLEAN_REVIEW_STATUS.test(normalized) && !NEEDS_CORRECTIONS_STATUS.test(normalized);
  const requires_corrections = items.length > 0 || (NEEDS_CORRECTIONS_STATUS.test(normalized) && !explicitlyClean);
  return { requires_corrections, items };
}

function cleanupSpacing(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([.!؟،,:;])/g, "$1")
    .replace(/\.\.(?!\.)/g, ".")
    .replace(/[ \t]+\n/g, "\n");
}

function escapeRegexToken(token: string): string {
  return token
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/["“”]/gu, '["“”]')
    .replace(/['’]/gu, "['’]");
}

function findMatchSpan(document: string, coreTarget: string): { index: number; length: number; matched: string } | null {
  const candidates = [coreTarget];
  if (coreTarget.endsWith(".")) {
    const trimmed = coreTarget.slice(0, -1).trim();
    if (trimmed) candidates.push(trimmed);
  }
  for (const candidate of candidates) {
    const exactIndex = document.indexOf(candidate);
    if (exactIndex >= 0) {
      return { index: exactIndex, length: candidate.length, matched: candidate };
    }
  }
  // Fallback: match across collapsed newlines / repeated spaces (e.g. a
  // multi-paragraph passage quoted on one line by Brand Guardian), smart vs.
  // straight quotes, and optional inline markdown emphasis, while refusing to
  // span across section headings or horizontal dividers.
  for (const candidate of candidates) {
    const tokens = candidate.split(/\s+/u).filter(Boolean);
    if (!tokens.length) continue;
    const pattern = tokens.map((token) => `(?:\\*{1,2})?${escapeRegexToken(token)}(?:\\*{1,2})?`).join("\\s+");
    const regex = new RegExp(pattern, "gu");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(document)) !== null) {
      const matched = match[0];
      if (/\n\s*(?:#{1,6}\s|[-=_]{3,}\s*(?:\n|$))/u.test(matched)) continue;
      return { index: match.index, length: matched.length, matched };
    }
  }
  return null;
}

function overlapAwareReplaceOnce(document: string, coreExact: string, coreProposed: string): { next: string; applied: boolean; replacement: string } {
  const span = findMatchSpan(document, coreExact);
  if (!span) return { next: document, applied: false, replacement: coreProposed };

  let replaceStart = span.index;
  let replaceEnd = span.index + span.length;
  const target = span.matched;
  let effectiveProposed = coreProposed;

  // Case A: proposed revision includes preceding words that already sit immediately before the match
  // (e.g. exact: "المتوفرة لديكم", proposed: "والأجهزة الذكية المتوفرة في متجرنا.").
  const before = document.slice(Math.max(0, replaceStart - 80), replaceStart);
  let bestPrefix = 0;
  for (let len = Math.min(before.length, effectiveProposed.length - 1); len >= 3; len -= 1) {
    const candidate = effectiveProposed.slice(0, len);
    if (before.endsWith(candidate) && (len === before.length || /\s/u.test(before[before.length - len - 1]) || /\s/u.test(candidate[0]))) {
      bestPrefix = len;
      break;
    }
  }
  if (bestPrefix > 0) {
    replaceStart -= bestPrefix;
  } else {
    // Case B: proposed revision prepends a slightly different inflection of the preceding words
    // while sharing the opening phrase of `target`
    // (e.g. doc: "...للانضمام إلى جلسات التذوق في محبتنا في عمان", proposed: "الانضمام إلى جلسات التذوق في محمصتنا في عمان").
    const words = target.split(/\s+/u).filter(Boolean);
    if (words.length >= 2) {
      const anchor = words.slice(0, Math.min(3, words.length - 1)).join(" ");
      const anchorPos = effectiveProposed.indexOf(anchor);
      if (anchorPos > 0) {
        const leadingInProposed = effectiveProposed.slice(0, anchorPos).trim();
        const leadingTokens = leadingInProposed.split(/\s+/u);
        const tailToken = leadingTokens[leadingTokens.length - 1] || "";
        if (tailToken && before.trimEnd().endsWith(tailToken)) {
          effectiveProposed = effectiveProposed.slice(anchorPos);
        }
      }
    }
  }

  // Avoid doubling a trailing period when the document already has one right after `target`.
  if (effectiveProposed.endsWith(".") && document[replaceEnd] === ".") {
    replaceEnd += 1;
  }

  const next = cleanupSpacing(`${document.slice(0, replaceStart)}${effectiveProposed}${document.slice(replaceEnd)}`);
  return { next, applied: next !== document, replacement: effectiveProposed };
}

function overlapAwareReplace(document: string, exactRaw: string, proposedRaw: string): { next: string; applied: boolean; replacement: string } {
  const coreExact = stripEllipses(exactRaw);
  const coreProposed = stripEllipses(proposedRaw);
  if (!coreExact || !coreProposed || coreExact === coreProposed) {
    return { next: document, applied: false, replacement: coreProposed };
  }
  let working = document;
  let appliedAny = false;
  let lastReplacement = coreProposed;
  for (let pass = 0; pass < 10; pass += 1) {
    const step = overlapAwareReplaceOnce(working, coreExact, coreProposed);
    if (!step.applied) break;
    working = step.next;
    appliedAny = true;
    lastReplacement = step.replacement;
    if (coreProposed.includes(coreExact) || findMatchSpan(coreProposed, coreExact) !== null) break;
  }
  return { next: working, applied: appliedAny, replacement: lastReplacement };
}

function removePassage(document: string, item: ReviewCorrectionItem, isSummary = false): { next: string; applied: boolean } {
  let next = document;
  const coreExact = stripEllipses(item.exact);
  if (coreExact) {
    const escaped = coreExact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`\\s*${escaped}`, "gu"), "");
    if (next === document && coreExact.endsWith(".")) {
      const noDot = coreExact.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      next = next.replace(new RegExp(`\\s*${noDot}\\.?`, "gu"), "");
    }
    if (next === document) {
      for (let pass = 0; pass < 10; pass += 1) {
        const span = findMatchSpan(next, coreExact);
        if (!span) break;
        const start = span.index > 0 && /[ \t]/.test(next[span.index - 1]) ? span.index - 1 : span.index;
        const updated = `${next.slice(0, start)}${next.slice(span.index + span.length)}`;
        if (updated === next) break;
        next = updated;
      }
    }
  }
  if (item.remove_meta_notes) {
    next = next.replace(CUSTOMER_META_NOTE, "");
    if (isSummary) next = next.replace(TRUNCATED_META_NOTE, "");
  }
  next = cleanupSpacing(next);
  return { next, applied: next !== document };
}

function readStepDocument(step: ReviewableStep): string {
  if (typeof step.result?.document === "string") return step.result.document;
  if (typeof step.document === "string") return step.document;
  return "";
}

function writeStepDocument<T extends ReviewableStep>(step: T, document: string, applied: AppliedReviewCorrection[]): T & { applied_corrections?: AppliedReviewCorrection[] } {
  const nextStep = step.result && typeof step.result.document === "string"
    ? { ...step, result: { ...step.result, document } }
    : typeof step.document === "string"
      ? { ...step, document }
      : { ...step };
  return applied.length ? { ...nextStep, applied_corrections: applied } : nextStep;
}

const TARGET_PROFILES = new Set(["social_media_strategist", "content_creator", "executive_summary"]);

export function applyWorkspaceReviewCorrections<T extends ReviewableStep>(steps: T[]): {
  steps: (T & { applied_corrections?: AppliedReviewCorrection[] })[];
  summary: WorkspaceReviewCorrectionsSummary;
} {
  const reviewStep = steps.find((step) => step.profile_code === "brand_guardian");
  const reviewDoc = reviewStep ? readStepDocument(reviewStep) : "";
  if (!reviewDoc) {
    return {
      steps: steps.map((step) => ({ ...step })),
      summary: {
        has_review: false,
        requires_corrections: false,
        parsed_count: 0,
        applied_count: 0,
        applied: [],
        unresolved: [],
        needs_changes: false,
      },
    };
  }

  const parsed = parseBrandGuardianCorrections(reviewDoc);
  const allApplied: AppliedReviewCorrection[] = [];
  const appliedIds = new Set<string>();
  const perStepApplied = new Map<number, AppliedReviewCorrection[]>();
  const updatedDocs = new Map<number, string>();

  for (const step of steps) {
    if (!TARGET_PROFILES.has(step.profile_code)) continue;
    const original = readStepDocument(step);
    if (!original) continue;
    const isSummary = step.profile_code === "executive_summary";
    // In executive summaries, only apply Task 3 corrections to sections 1 & 2
    // so Brand Guardian's own quoted audit findings in section 3 stay verbatim.
    const summaryBoundary = isSummary ? original.search(/\n3\.\s+/u) : -1;
    let working = summaryBoundary >= 0 ? original.slice(0, summaryBoundary) : original;
    const summaryTail = summaryBoundary >= 0 ? original.slice(summaryBoundary) : "";
    const stepApplied: AppliedReviewCorrection[] = [];

    for (const item of parsed.items) {
      if (item.action === "remove") {
        const result = removePassage(working, item, isSummary);
        if (result.applied) {
          working = result.next;
          appliedIds.add(item.id);
          if (!isSummary) {
            const record: AppliedReviewCorrection = {
              step_sequence: step.sequence,
              profile_code: step.profile_code,
              exact: item.exact,
              replacement: "",
              action: "remove",
            };
            stepApplied.push(record);
            allApplied.push(record);
          }
        }
      } else if (item.proposed) {
        const result = overlapAwareReplace(working, item.exact, item.proposed);
        if (result.applied) {
          working = result.next;
          appliedIds.add(item.id);
          if (!isSummary) {
            const record: AppliedReviewCorrection = {
              step_sequence: step.sequence,
              profile_code: step.profile_code,
              exact: item.exact,
              replacement: result.replacement,
              action: "replace",
            };
            stepApplied.push(record);
            allApplied.push(record);
          }
        }
      }
    }

    const finalDocument = `${working}${summaryTail}`;
    if (finalDocument !== original) {
      updatedDocs.set(step.sequence, finalDocument);
      if (stepApplied.length) perStepApplied.set(step.sequence, stepApplied);
    }
  }

  const unresolved = parsed.items.filter((item) => !appliedIds.has(item.id));
  const needs_changes = parsed.requires_corrections && (unresolved.length > 0 || parsed.items.length === 0);

  const nextSteps = steps.map((step) => {
    const revised = updatedDocs.get(step.sequence);
    const stepApplied = perStepApplied.get(step.sequence) ?? [];
    if (revised === undefined) return { ...step };
    return writeStepDocument(step, revised, stepApplied);
  });

  return {
    steps: nextSteps,
    summary: {
      has_review: true,
      requires_corrections: parsed.requires_corrections,
      parsed_count: parsed.items.length,
      applied_count: allApplied.length,
      applied: allApplied,
      unresolved,
      needs_changes,
    },
  };
}
