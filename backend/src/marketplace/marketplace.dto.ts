import { IsString, IsInt, IsPositive, IsOptional, Min, Max, ArrayMaxSize, ArrayMinSize, Length, MaxLength } from "class-validator";
import { Type } from "class-transformer";

export class CreateListingDto {
  @IsString() @Length(1, 64) listingId: string;
  @IsString() @Length(1, 64) projectId: string;
  @IsString() @Length(1, 64) batchId: string;
  // seller is intentionally omitted — always set from req.user.publicKey in the controller
  @IsInt() @IsPositive() @Type(() => Number) amountAvailable: number;
  @IsString() @Length(1, 32) pricePerCredit: string;
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
  @IsInt() @IsOptional() @Type(() => Number) vintage?: number;
  @IsString() @IsOptional() @MaxLength(64) country?: string;
  @IsString() @IsOptional() @MaxLength(32) minPrice?: string;
  @IsString() @IsOptional() @MaxLength(32) maxPrice?: string;
  @IsString() @IsOptional() @MaxLength(128) search?: string;
  @IsString() @IsOptional() @MaxLength(128) cursor?: string;
  @IsInt() @Min(1) @Max(100) @Type(() => Number) @IsOptional() limit?: number = 20;
}

export class PaginatedListingsResponse {
  listings: any[];
  next_cursor?: string;
  total_count: number;
}
