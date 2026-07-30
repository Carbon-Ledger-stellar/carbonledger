import {
  IsString,
  IsInt,
  IsPositive,
  IsOptional,
  Min,
  Max,
  ArrayMaxSize,
  ArrayMinSize,
  MaxLength,
  Length,
  Matches,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsStellarAddress, IsVintageYear } from '../common/validators';

/** Regex for a price-per-tonne string: digits with optional decimal (e.g. "12.50") */
const PRICE_REGEX = /^\d+(\.\d{1,2})?$/;

/**
 * DTO for creating a new marketplace listing.
 *
 * Validation:
 *  - listingId / projectId / credit_batch_id: non-empty strings, max 64 chars
 *  - amount: positive integer
 *  - price_per_tonne: decimal string (e.g. "12.50"), max 32 chars
 *  - vintageYear: 1990 – current year + 1 via @IsVintageYear
 *  - methodology / country: non-empty strings, max 64 chars
 */
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
  @IsString()
  @IsOptional()
  @MaxLength(64)
  methodology?: string;

  /** Filter by vintage year (1990 – current year + 5). */
  @IsInt()
  @Min(1990)
  @Max(new Date().getFullYear() + 5)
  @IsOptional()
  @Type(() => Number)
  vintage?: number;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  country?: string;

  /** Minimum price per tonne filter (decimal string). */
  @IsString()
  @IsOptional()
  @MaxLength(32)
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'minPrice must be a positive decimal string (e.g. "10.00")',
  })
  minPrice?: string;

  /** Maximum price per tonne filter (decimal string). */
  @IsString()
  @IsOptional()
  @MaxLength(32)
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'maxPrice must be a positive decimal string (e.g. "100.00")',
  })
  maxPrice?: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  search?: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  cursor?: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
  limit?: number = 20;
}

export class PaginatedListingsResponse {
  listings: any[];
  next_cursor?: string;
  total_count: number;
  page?: number;
  total_pages?: number;
}
