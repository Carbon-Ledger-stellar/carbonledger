import { IsString, Length, Validate, IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import {
  IsStellarAddress,
  IsSerialNumber,
  ValidateSerialRange,
  IsVintageYear,
  IsCreditAmount,
  IsIpfsCid,
} from '../common/validators';

/**
 * DTO for minting a new batch of carbon credits.
 *
 * Validation:
 *  - batchId / projectId: non-empty strings, max 64 chars
 *  - vintageYear: integer 1990 – (current year + 1) via @IsVintageYear
 *  - amount: positive, min 0.01, max 2 decimal places via @IsCreditAmount
 *  - serialStart / serialEnd: non-negative integer strings via @IsSerialNumber
 *  - Class-level: serialEnd >= serialStart via @ValidateSerialRange
 *  - metadataCid: valid IPFS CID (v0 or v1) via @IsIpfsCid
 */
@ValidateSerialRange()
export class MintCreditsDto {
  @IsString()
  @Length(1, 64)
  batchId: string;

  @IsString()
  @Length(1, 64)
  projectId: string;

  /** Vintage year of the carbon credit. Must be between 1990 and current year + 1. */
  @IsVintageYear()
  @Type(() => Number)
  vintageYear: number;

  /**
   * Credit amount in tCO₂e.
   * Must be ≥ 0.01, ≤ 1,000,000,000, with at most 2 decimal places.
   */
  @IsCreditAmount()
  @Type(() => Number)
  amount: number;

  /** First serial number in the batch range (non-negative integer string). */
  @IsSerialNumber()
  @IsString()
  @Length(1, 16)
  serialStart: string;

  /** Last serial number in the batch range (must be ≥ serialStart). */
  @IsSerialNumber()
  @IsString()
  @Length(1, 16)
  serialEnd: string;

  /** IPFS CID (v0 or v1) of the credit batch metadata document. */
  @IsIpfsCid()
  metadataCid: string;
}

/**
 * DTO for retiring carbon credits permanently.
 *
 * Validation:
 *  - batchId: non-empty string, max 64 chars
 *  - amount: positive, min 0.01, max 2 decimal places via @IsCreditAmount
 *  - beneficiary: non-empty string, max 100 chars
 *  - retirementReason: non-empty string, max 500 chars
 *  - holderPublicKey: valid Stellar G... address via @IsStellarAddress
 */
export class RetireCreditsDto {
  @IsString()
  @Length(1, 64)
  batchId: string;

  /**
   * Credit amount in tCO₂e to retire.
   * Must be ≥ 0.01, ≤ 1,000,000,000, with at most 2 decimal places.
   */
  @IsCreditAmount()
  @Type(() => Number)
  amount: number;

  @IsString()
  @Length(1, 100)
  beneficiary: string;

  @IsString()
  @Length(1, 500)
  retirementReason: string;

  /** Stellar public key of the account holding the credits being retired. */
  @IsStellarAddress()
  holderPublicKey: string;
}

export class BatchMintCreditsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MintCreditsDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  items: MintCreditsDto[];
}

export class BatchRetireCreditsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RetireCreditsDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  items: RetireCreditsDto[];
}

export interface BatchItemStatus<T = any> {
  index: number;
  status: 'success' | 'error';
  itemIdentifier?: string;
  data?: T;
  error?: string;
}

export interface BatchOperationResult<T = any> {
  success: boolean;
  totalProcessed: number;
  successCount: number;
  errorCount: number;
  results: BatchItemStatus<T>[];
}

