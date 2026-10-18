import { useCallback, useEffect, useRef, useState } from 'react';

interface SearchResult {
  id: string;
  label: string;
}

interface SearchAutocompleteProps {
  onSelect?: (result: SearchResult) => void;
  placeholder?: string;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 250;

export default function SearchAutocomplete({
  onSelect,
  placeholder = 'Search...',
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: SearchAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  const runSearch = useCallback(async (term: string) => {
    if (abortController.current) {
      abortController.current.abort();
    }

    const controller = new AbortController();
    abortController.current = controller;
    const currentRequestId = ++requestId.current;

    if (!term.trim()) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(term)}`,
        { signal: controller.signal },
      );

      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }

      const data: SearchResult[] = await response.json();

      // Ignore stale responses that resolve after a newer request started.
      if (currentRequestId !== requestId.current) {
        return;
      }

      setResults(data);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      if (currentRequestId !== requestId.current) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      if (currentRequestId === requestId.current) {
        setLoading(false);
      }
    }
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setQuery(value);

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      debounceTimer.current = setTimeout(() => {
        void runSearch(value);
      }, debounceMs);
    },
    [debounceMs, runSearch],
  );

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      if (abortController.current) {
        abortController.current.abort();
      }
    };
  }, []);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      onSelect?.(result);
    },
    [onSelect],
  );

  return (
    <div className="search-autocomplete">
      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label="Search"
        aria-busy={loading}
      />
      {loading && <div className="search-autocomplete__loading">Loading...</div>}
      {error && <div className="search-autocomplete__error">{error}</div>}
      {results.length > 0 && (
        <ul className="search-autocomplete__results">
          {results.map((result) => (
            <li key={result.id}>
              <button type="button" onClick={() => handleSelect(result)}>
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
