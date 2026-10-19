export type MarketplaceSortOrder = "newest" | "oldest" | "price-asc" | "price-desc" | "popular";

export interface MarketplaceFilterState {
  search: string;
  categories: string[];
  minPrice: number | null;
  maxPrice: number | null;
  sort: MarketplaceSortOrder;
}

export const DEFAULT_MARKETPLACE_FILTERS: MarketplaceFilterState = {
  search: "",
  categories: [],
  minPrice: null,
  maxPrice: null,
  sort: "newest",
};

const SORT_ORDERS: MarketplaceSortOrder[] = [
  "newest",
  "oldest",
  "price-asc",
  "price-desc",
  "popular",
];

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSort(value: string | null): MarketplaceSortOrder {
  if (value && (SORT_ORDERS as string[]).includes(value)) {
    return value as MarketplaceSortOrder;
  }
  return DEFAULT_MARKETPLACE_FILTERS.sort;
}

function parseCategories(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((category) => category.trim())
    .filter((category) => category.length > 0);
}

/**
 * Parse marketplace filter/sort state from URL query params.
 * Accepts a URLSearchParams instance or a raw query string.
 */
export function parseFilterParams(
  params: URLSearchParams | string
): MarketplaceFilterState {
  const searchParams =
    typeof params === "string" ? new URLSearchParams(params) : params;

  return {
    search: searchParams.get("q") ?? DEFAULT_MARKETPLACE_FILTERS.search,
    categories: parseCategories(searchParams.get("categories")),
    minPrice: parseNumber(searchParams.get("minPrice")),
    maxPrice: parseNumber(searchParams.get("maxPrice")),
    sort: parseSort(searchParams.get("sort")),
  };
}

/**
 * Serialize marketplace filter/sort state into URL query params.
 * Default values are omitted to keep URLs clean and shareable.
 */
export function serializeFilterParams(
  state: MarketplaceFilterState
): URLSearchParams {
  const params = new URLSearchParams();

  if (state.search && state.search !== DEFAULT_MARKETPLACE_FILTERS.search) {
    params.set("q", state.search);
  }

  if (state.categories.length > 0) {
    params.set("categories", state.categories.join(","));
  }

  if (state.minPrice !== null) {
    params.set("minPrice", String(state.minPrice));
  }

  if (state.maxPrice !== null) {
    params.set("maxPrice", String(state.maxPrice));
  }

  if (state.sort !== DEFAULT_MARKETPLACE_FILTERS.sort) {
    params.set("sort", state.sort);
  }

  return params;
}

/**
 * Build a full marketplace URL (path + query) for the given filter state.
 */
export function buildMarketplaceUrl(
  state: MarketplaceFilterState,
  path = "/marketplace"
): string {
  const query = serializeFilterParams(state).toString();
  return query ? `${path}?${query}` : path;
}
