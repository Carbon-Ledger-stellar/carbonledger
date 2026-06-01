import { IsString, IsInt, IsNumber, IsPositive, Min, Max, Matches, Length, MaxLength } from "class-validator";
import { Type } from "class-transformer";

const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;

export class MintCreditsDto {
  @IsString() @Length(1, 64) batchId: string;
  @IsString() @Length(1, 64) projectId: string;
  @IsInt() @IsPositive() @Min(1990) @Max(new Date().getFullYear() + 1) @Type(() => Number) vintageYear: number;
  /** Supports fractional tonnes, e.g. 0.5. Minimum 0.01 tCO₂e. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Type(() => Number) amount: number;
  @IsString() @Matches(/^[0-9]+$/, { message: 'serialStart must be a positive integer string' }) @Length(1, 32) serialStart: string;
  @IsString() @Matches(/^[0-9]+$/, { message: 'serialEnd must be a positive integer string' }) @Length(1, 32) serialEnd: string;
  @IsString() @Matches(CID_REGEX, { message: "metadataCid must be a valid IPFS CID (CIDv0 or CIDv1)" }) metadataCid: string;
}

export class RetireCreditsDto {
  @IsString() @Length(1, 64) batchId: string;
  /** Supports fractional tonnes, e.g. 0.5. Minimum 0.01 tCO₂e. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Type(() => Number) amount: number;
  @IsString() @Length(1, 64) beneficiary: string;
  @IsString() @MaxLength(256) retirementReason: string;
  @IsString() @Length(1, 64) holderPublicKey: string;
}
