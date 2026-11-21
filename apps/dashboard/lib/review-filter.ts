// Filtering, sorting and position labels for the review queues (/actions and
// /approvals). Kept free of React so the zero-match behaviour is executed by the
// tests instead of only being asserted against source text.

export type ReviewSort = "newest" | "oldest" | "title";

export interface ReviewFilter<T> {
  query: string;
  sort: ReviewSort;
  /** Extra predicate for the status/type select. */
  matches?: (item: T) => boolean;
  /** Text the search box looks in. */
  haystack: (item: T) => string;
  /** Title used by the A–Z sort and the locale comparison. */
  title?: (item: T) => string;
  createdAt: (item: T) => string;
  locale?: "en" | "ar";
}

export function applyReviewFilters<T>(items: T[], filter: ReviewFilter<T>): T[] {
  const needle = filter.query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const matchesFilter = filter.matches ? filter.matches(item) : true;
    return matchesFilter && (!needle || filter.haystack(item).toLowerCase().includes(needle));
  });
  const titleOf = filter.title ?? filter.haystack;
  return [...filtered].sort((a, b) => filter.sort === "title"
    ? titleOf(a).localeCompare(titleOf(b), filter.locale)
    : filter.sort === "oldest"
      ? new Date(filter.createdAt(a)).getTime() - new Date(filter.createdAt(b)).getTime()
      : new Date(filter.createdAt(b)).getTime() - new Date(filter.createdAt(a)).getTime());
}

/**
 * "3 of 8" for an item that is inside the current view. An item outside the
 * filtered view has no position, so this returns an empty label rather than
 * "0 of 0" beside an item the filters exclude.
 */
export function reviewPositionLabel(index: number, count: number, locale: "en" | "ar" = "en"): string {
  if (index < 0 || count <= 0) return "";
  return locale === "ar" ? `${index + 1} من ${count}` : `${index + 1} of ${count}`;
}

export function reviewFiltersActive(query: string, filterValue: string, defaultFilter: string, sort: string): boolean {
  return query.trim().length > 0 || filterValue !== defaultFilter || sort !== "newest";
}

/** The state "Clear filters" writes back: every record in the queue, newest first. */
export function clearedReviewFilters() {
  return { query: "", filter: "all" as const, sort: "newest" as const };
}
