import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { MarketplaceSortControls } from './MarketplaceSortControls';

export type MarketplaceFilters = {
  category?: string;
  priceMin?: number;
  priceMax?: number;
  search?: string;
};

export type MarketplaceSort = 'newest' | 'oldest' | 'price-asc' | 'price-desc';

const SORT_VALUES: MarketplaceSort[] = ['newest', 'oldest', 'price-asc', 'price-desc'];

const parseNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const firstString = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === 'string' && value !== '' ? value : undefined;
};

export const parseMarketplaceQuery = (query: Record<string, unknown>): {
  filters: MarketplaceFilters;
  sort: MarketplaceSort;
} => {
  const sortParam = firstString(query.sort);
  const sort = SORT_VALUES.includes(sortParam as MarketplaceSort)
    ? (sortParam as MarketplaceSort)
    : 'newest';

  return {
    filters: {
      category: firstString(query.category),
      priceMin: parseNumber(firstString(query.priceMin)),
      priceMax: parseNumber(firstString(query.priceMax)),
      search: firstString(query.search),
    },
    sort,
  };
};

export const serializeMarketplaceQuery = (
  filters: MarketplaceFilters,
  sort: MarketplaceSort,
): Record<string, string> => {
  const query: Record<string, string> = {};
  if (filters.category) query.category = filters.category;
  if (filters.priceMin !== undefined) query.priceMin = String(filters.priceMin);
  if (filters.priceMax !== undefined) query.priceMax = String(filters.priceMax);
  if (filters.search) query.search = filters.search;
  if (sort && sort !== 'newest') query.sort = sort;
  return query;
};

export interface MarketplaceFilterProps {
  categories?: string[];
  onChange?: (filters: MarketplaceFilters, sort: MarketplaceSort) => void;
}

export function MarketplaceFilter({ categories = [], onChange }: MarketplaceFilterProps) {
  const router = useRouter();

  const initial = useMemo(() => parseMarketplaceQuery(router.query), [router.query]);
  const [filters, setFilters] = useState<MarketplaceFilters>(initial.filters);
  const [sort, setSort] = useState<MarketplaceSort>(initial.sort);

  // Restore state when the URL changes (back/forward navigation or shared link).
  useEffect(() => {
    const parsed = parseMarketplaceQuery(router.query);
    setFilters(parsed.filters);
    setSort(parsed.sort);
  }, [router.query]);

  const syncUrl = useCallback(
    (nextFilters: MarketplaceFilters, nextSort: MarketplaceSort) => {
      const query = serializeMarketplaceQuery(nextFilters, nextSort);
      const current = serializeMarketplaceQuery(
        parseMarketplaceQuery(router.query).filters,
        parseMarketplaceQuery(router.query).sort,
      );
      if (JSON.stringify(query) === JSON.stringify(current)) return;
      router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
    },
    [router],
  );

  const updateFilters = useCallback(
    (patch: Partial<MarketplaceFilters>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        syncUrl(next, sort);
        onChange?.(next, sort);
        return next;
      });
    },
    [onChange, sort, syncUrl],
  );

  const updateSort = useCallback(
    (nextSort: MarketplaceSort) => {
      setSort(nextSort);
      syncUrl(filters, nextSort);
      onChange?.(filters, nextSort);
    },
    [filters, onChange, syncUrl],
  );

  return (
    <div className="marketplace-filter">
      <input
        type="search"
        placeholder="Search marketplace"
        value={filters.search ?? ''}
        onChange={(e) => updateFilters({ search: e.target.value || undefined })}
      />

      <select
        value={filters.category ?? ''}
        onChange={(e) => updateFilters({ category: e.target.value || undefined })}
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>

      <input
        type="number"
        placeholder="Min price"
        value={filters.priceMin ?? ''}
        onChange={(e) => updateFilters({ priceMin: parseNumber(e.target.value) })}
      />

      <input
        type="number"
        placeholder="Max price"
        value={filters.priceMax ?? ''}
        onChange={(e) => updateFilters({ priceMax: parseNumber(e.target.value) })}
      />

      <MarketplaceSortControls value={sort} onChange={updateSort} />
    </div>
  );
}

export default MarketplaceFilter;
