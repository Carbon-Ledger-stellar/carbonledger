import { IsString, IsInt, IsPositive, IsOptional, Min, Max, ArrayMaxSize, ArrayMinSize, Length, MaxLength, IsIn } from "class-validator";
import { Type } from "class-transformer";

export const LISTING_SORT_FIELDS = ["price", "vintageYear", "methodology", "verificationDate"] as const;
export type ListingSortField = (typeof LISTING_SORT_FIELDS)[number];

export const SORT_ORDERS = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export class CreateListingDto {
  @IsString() @Length(1, 64) listingId: string;
  @IsString() @Length(1, 64) projectId: string;
  @IsString() @Length(1, 64) credit_batch_id: string;
  // seller is intentionally omitted — always set from req.user.publicKey in the controller
  @IsInt() @IsPositive() @Type(() => Number) amount: number;
  @IsString() @Length(1, 32) price_per_tonne: string;
  @IsInt() @Min(1990) @Max(new Date().getFullYear() + 1) @Type(() => Number) vintageYear: number;
  @IsString() @Length(1, 64) methodology: string;
  @IsString() @Length(1, 64) country: string;
}

export class PurchaseDto {
  @IsString() @Length(1, 64) listingId: string;
  @IsInt() @IsPositive() @Type(() => Number) amount: number;
  // buyerPublicKey is set from req.user.publicKey in the controller
  buyerPublicKey?: string;
}

export class BulkPurchaseDto {
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)  // Fix API4: cap bulk operations to prevent resource exhaustion
  listingIds: string[];

  @IsInt({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  amounts: number[];

  // buyerPublicKey is set from req.user.publicKey in the controller
  buyerPublicKey?: string;
}

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
  @IsString() @IsOptional() @IsIn(LISTING_SORT_FIELDS) sortBy?: ListingSortField;
  @IsString() @IsOptional() @IsIn(SORT_ORDERS) sortOrder?: SortOrder = "asc";
}

export class PaginatedListingsResponse {
  listings: any[];
  next_cursor?: string;
  total_count: number;
  page?: number;
  total_pages?: number;
}
