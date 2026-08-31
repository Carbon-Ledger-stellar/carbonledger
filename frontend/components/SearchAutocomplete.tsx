"use client";

import { useEffect, useRef, useState } from "react";
import { colors } from "../styles/design-system";
import Highlight from "./Highlight";

export interface SearchAutocompleteProps {
  id: string;
  value: string;
  /** Fired on every keystroke (already debounced internally before suggestions are computed). */
  onChange: (value: string) => void;
  /** Fired when a suggestion is committed (click, or Enter on a highlighted option). */
  onSelect?: (value: string) => void;
  /** Full pool of suggestable terms — filtered client-side, so this can safely be 1000+ items. */
  suggestions: string[];
  placeholder?: string;
  ariaLabel?: string;
  /** Minimum characters typed before suggestions are shown. Defaults to 2. */
  minChars?: number;
  /** Cap on how many suggestions render at once. Defaults to 8. */
  maxSuggestions?: number;
  /** Debounce delay before filtering runs, in ms. Defaults to 150. */
  debounceMs?: number;
  inputStyle?: React.CSSProperties;
  leadingIcon?: React.ReactNode;
  /** Marks the input as a target for the global "/" focus-search keyboard shortcut. */
  "data-shortcut-target"?: string;
}

/**
 * A text input with a debounced, keyboard-navigable suggestions dropdown,
 * filtered client-side from `suggestions`. Follows the WAI-ARIA combobox
 * pattern (role="combobox" + a listbox popup) so it works the same for
 * mouse and keyboard/screen-reader users.
 */
export default function SearchAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  suggestions,
  placeholder,
  ariaLabel,
  minChars = 2,
  maxSuggestions = 8,
  debounceMs = 150,
  inputStyle,
  leadingIcon,
  "data-shortcut-target": dataShortcutTarget,
}: SearchAutocompleteProps) {
  const [query, setQuery] = useState(value);
  const [debouncedQuery, setDebouncedQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id}-listbox`;

  // Stay in sync if the parent resets `value` externally (e.g. "Clear filters").
  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, debounceMs]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [debouncedQuery]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const trimmed = debouncedQuery.trim();
  const matches =
    trimmed.length >= minChars
      ? Array.from(
          new Set(suggestions.filter((s) => s.toLowerCase().includes(trimmed.toLowerCase())))
        ).slice(0, maxSuggestions)
      : [];

  function commit(next: string) {
    setQuery(next);
    onChange(next);
    onSelect?.(next);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) {
      if (e.key === "ArrowDown" && matches.length > 0) {
        setOpen(true);
        setActiveIndex(0);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
        break;
      case "Enter":
        if (activeIndex >= 0) {
          e.preventDefault();
          commit(matches[activeIndex]);
        }
        break;
      case "Escape":
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {leadingIcon}
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        data-shortcut-target={dataShortcutTarget}
        placeholder={placeholder}
        value={query}
        style={inputStyle}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 0.25rem)",
            left: 0,
            right: 0,
            zIndex: 20,
            background: colors.surface,
            border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.5rem",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            listStyle: "none",
            margin: 0,
            padding: "0.35rem",
            maxHeight: "280px",
            overflowY: "auto",
          }}
        >
          {matches.map((m, i) => (
            <li
              key={m}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(m);
              }}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                padding: "0.5rem 0.6rem",
                borderRadius: "0.375rem",
                cursor: "pointer",
                fontSize: "0.875rem",
                background: i === activeIndex ? colors.primary[50] : "transparent",
                color: colors.neutral[800],
              }}
            >
              <Highlight text={m} query={trimmed} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
