import { IsString, IsInt, IsPositive, IsOptional, Min, Max, ArrayMaxSize, ArrayMinSize, Length, MaxLength, IsIn, Matches } from "class-validator";
import { Type } from "class-transformer";
import { IsVintageYear } from '../common/validators';

/** Regex for a positive decimal price string, e.g. "12.50" or "100". */
const PRICE_REGEX = /^\d+(\.\d{1,7})?$/;

export const LISTING_SORT_FIELDS = ["price", "vintageYear", "methodology", "verificationDate"] as const;
export type ListingSortField = (typeof LISTING_SORT_FIELDS)[number];

export const SORT_ORDERS = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export class CreateListingDto {
  @IsString()
  @Length(1, 64)
  listingId: string;

  @IsString()
  @Length(1, 64)
  projectId: string;

  @IsString()
  @Length(1, 64)
  credit_batch_id: string;

  // seller is intentionally omitted — always set from req.user.publicKey in the controller

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  amount: number;

  /** Price per tonne in USDC. Must be a positive decimal string (e.g. "12.50"). */
  @IsString()
  @Length(1, 32)
  @Matches(PRICE_REGEX, { message: 'price_per_tonne must be a positive decimal string (e.g. "12.50")' })
  price_per_tonne: string;

  /** Vintage year of the credits being listed. Must be between 1990 and current year + 1. */
  @IsVintageYear()
  @Type(() => Number)
  vintageYear: number;

  @IsString()
  @Length(1, 64)
  methodology: string;

  @IsString()
  @Length(1, 64)
  country: string;
}

export class BatchCreateListingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateListingDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  items: CreateListingDto[];
}


/**
 * DTO for purchasing credits from a single listing.
 *
 * Validation:
 *  - listingId: non-empty string, max 64 chars
 *  - amount: positive integer
 *  - buyerPublicKey: set from req.user.publicKey (optional on incoming request)
 */
export class PurchaseDto {
  @IsString()
  @Length(1, 64)
  listingId: string;

  @IsInt()
  @IsPositive()
  @Type(() => Number)
  amount: number;

  // buyerPublicKey is set from req.user.publicKey in the controller
  buyerPublicKey?: string;
}

/**
 * DTO for bulk purchasing credits from multiple listings in one request.
 *
 * Validation:
 *  - listingIds: 1–50 strings, each max 64 chars
 *  - amounts: 1–50 positive integers
 *  - Length of listingIds and amounts must be equal (validated at service layer)
 */
export class BulkPurchaseDto {
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50) // Cap bulk operations to prevent resource exhaustion
  listingIds: string[];

  @IsInt({ each: true })
  @IsPositive({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  amounts: number[];

  // buyerPublicKey is set from req.user.publicKey in the controller
  buyerPublicKey?: string;
}

/**
 * DTO for querying / filtering marketplace listings.
 *
 * All fields are optional filters.
 */
export class ListingsQueryDto {
  @IsString() @IsOptional() @MaxLength(64) methodology?: string;
  @IsInt() @Min(1990) @Max(new Date().getFullYear() + 5) @IsOptional() @Type(() => Number) vintage?: number;
  @IsString() @IsOptional() @MaxLength(64) country?: string;
  @IsString() @IsOptional() @MaxLength(32) minPrice?: string;
  @IsString() @IsOptional() @MaxLength(32) maxPrice?: string;
  @IsString() @IsOptional() @MaxLength(128) search?: string;
  @IsString() @IsOptional() @MaxLength(128) cursor?: string;
  @IsInt() @Min(1) @Max(1000) @IsOptional() @Type(() => Number) page?: number;
  @IsInt() @Min(1) @Max(100) @Type(() => Number) @IsOptional() limit?: number = 20;
  @IsInt() @Min(0) @Type(() => Number) @IsOptional() offset?: number = 0;
  @IsString() @IsOptional() @IsIn(LISTING_SORT_FIELDS) sortBy?: ListingSortField;
  @IsString() @IsOptional() @IsIn(SORT_ORDERS) sortOrder?: SortOrder = "asc";
}

export class PaginatedListingsResponse {
  data: any[];
  listings: any[];
  total: number;
  total_count: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  has_more: boolean;
  nextOffset?: number | null;
  next_cursor?: string;
  prev_cursor?: string;
  page?: number;
  total_pages?: number;
}

// ── Marketplace Full-Text & Faceted Search ────────────────────────────────────

/** Allowed values for the sortBy parameter of the search endpoint. */
export type SearchSortBy =
  | 'relevance'    // ts_rank descending (default when search term present)
  | 'price_asc'    // pricePerCredit numeric ascending
  | 'price_desc'   // pricePerCredit numeric descending
  | 'vintage_asc'  // vintageYear ascending
  | 'vintage_desc' // vintageYear descending
  | 'createdAt';   // listing creation date descending

/**
 * Query DTO for GET /marketplace/search.
 *
 * All fields are optional; at least one of `search`, `methodology`,
 * `vintage`, `country`, `status`, or a price range must be supplied
 * (validated in the service, not here, to return a structured 400 rather
 * than a class-validator 422).
 *
 * Five or more faceted filters are supported simultaneously:
 *   - methodology   — exact match on the methodology field
 *   - vintage       — exact match on vintageYear
 *   - country       — exact match on the country field
 *   - minPrice      — lower bound on pricePerCredit (numeric cast)
 *   - maxPrice      — upper bound on pricePerCredit (numeric cast)
 *   - status        — listing lifecycle status (Active, PartiallyFilled …)
 *   - seller        — filter by seller public key
 */
export class SearchListingsDto {
  /** Full-text search query. Matched against project name, description,
   *  methodology, and country via plainto_tsquery('english', …). */
  @IsString() @IsOptional() @MaxLength(200) search?: string;

  /** Facet: one or more methodology strings (AND-ed as IN clause). */
  @IsString({ each: true }) @IsOptional() @MaxLength(64, { each: true })
  methodology?: string[];

  /** Facet: one or more vintageYear integers. */
  @IsInt({ each: true })
  @Min(1990, { each: true })
  @Max(new Date().getFullYear() + 5, { each: true })
  @IsOptional()
  @Type(() => Number)
  vintage?: number[];

  /** Facet: one or more country strings. */
  @IsString({ each: true }) @IsOptional() @MaxLength(64, { each: true })
  country?: string[];

  /** Facet: lower bound on pricePerCredit (numeric string, e.g. "10.00"). */
  @IsString() @IsOptional() @MaxLength(32) minPrice?: string;

  /** Facet: upper bound on pricePerCredit (numeric string, e.g. "50.00"). */
  @IsString() @IsOptional() @MaxLength(32) maxPrice?: string;

  /** Facet: listing status filter, e.g. "Active" | "PartiallyFilled". */
  @IsString({ each: true }) @IsOptional() @MaxLength(32, { each: true })
  status?: string[];

  /** Facet: seller public key filter. */
  @IsString() @IsOptional() @MaxLength(64) seller?: string;

  /** Sort order. Defaults to "relevance" when search is present, "createdAt" otherwise. */
  @IsString() @IsOptional()
  sortBy?: SearchSortBy;

  /** Opaque cursor for keyset pagination (value is the id of the last row seen). */
  @IsString() @IsOptional() @MaxLength(128) cursor?: string;

  /** Page size. Min 1, max 100. Defaults to 20. */
  @IsInt() @Min(1) @Max(100) @IsOptional() @Type(() => Number) limit?: number = 20;

  /** Offset for pagination. Defaults to 0. */
  @IsInt() @Min(0) @IsOptional() @Type(() => Number) offset?: number = 0;
}

/** A single search result row returned by the search endpoint. */
export interface SearchResultItem {
  id: string;
  listingId: string;
  projectId: string;
  batchId: string;
  seller: string;
  amountAvailable: string;
  pricePerCredit: string;
  vintageYear: number;
  methodology: string;
  country: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  /** ts_rank score — null when the query has no search term. */
  rank: number | null;
  /** Project name from the joined CarbonProject row. */
  projectName: string | null;
  /** Project verification status from the joined CarbonProject row. */
  projectStatus: string | null;
  /** Project methodology score (0-100) from the joined CarbonProject row. */
  methodologyScore: number | null;
}

/** Response envelope for GET /marketplace/search. */
export class SearchListingsResponse {
  results: SearchResultItem[];
  total_count: number;
  next_cursor?: string;
  /** Whether more pages exist beyond this one. */
  has_more: boolean;
}
