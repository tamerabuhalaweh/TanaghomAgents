"use client";

import { Search } from "lucide-react";

export interface ReviewFilterSelect {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

/**
 * The search/filter bar shared by /actions and /approvals. It is rendered
 * whenever the queue has items — never behind the selected item — so filtering
 * to zero matches keeps the controls and the empty state on screen. Without
 * that, a customer has no way to clear the filters except reloading the page.
 */
export function ReviewFilterBar({
  ar,
  query,
  onQuery,
  searchLabel,
  placeholder,
  selects,
  compact = false,
  showEmpty,
  emptyMessage,
  filtersActive,
  onClear,
}: {
  ar: boolean;
  query: string;
  onQuery: (value: string) => void;
  searchLabel: string;
  placeholder: string;
  selects: ReviewFilterSelect[];
  compact?: boolean;
  showEmpty: boolean;
  emptyMessage: string;
  filtersActive: boolean;
  onClear: () => void;
}) {
  return (
    <>
      <div className={compact ? "list-toolbar list-toolbar-compact" : "list-toolbar"}>
        <label className="search-field">
          <Search size={16} />
          <span className="sr-only">{searchLabel}</span>
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} />
        </label>
        <div className="list-toolbar-selects">
          {selects.map((select) => (
            <label className="list-select" key={select.label}>
              <span>{select.label}</span>
              <select value={select.value} onChange={(event) => select.onChange(event.target.value)}>
                {select.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      {showEmpty ? (
        <div className="list-filter-empty-state">
          <p className="list-filter-empty">{emptyMessage}</p>
          {filtersActive ? (
            <button className="secondary-button compact-button" type="button" onClick={onClear}>
              {ar ? "امسح عوامل التصفية" : "Clear filters"}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
