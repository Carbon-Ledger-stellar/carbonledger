import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type TimePeriod = 'month' | 'quarter' | 'year';

export class PortfolioMetricsQueryDto {
  @ApiProperty({ description: 'Wallet address of the corporate buyer', example: 'GABC123...' })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiPropertyOptional({
    enum: ['month', 'quarter', 'year'],
    default: 'year',
    description: 'Time period granularity for the breakdown',
  })
  @IsOptional()
  @IsIn(['month', 'quarter', 'year'])
  period?: TimePeriod = 'year';
}

export interface MethodologyBreakdown {
  methodology: string;
  totalTonnes: number;
  retirementCount: number;
  percentage: number;
}

export interface VintageBreakdown {
  vintageYear: number;
  totalTonnes: number;
  retirementCount: number;
  percentage: number;
}

export interface TimePeriodBreakdown {
  period: string;           // e.g. "2025-Q1", "2025-03", "2025"
  totalPurchased: number;
  totalRetired: number;
  retirementCount: number;
}

export interface PortfolioMetricsResponse {
  ownerAddress: string;
  /** Gross tonnes ever retired by this buyer (includes invalidated) */
  totalTonnesPurchased: number;
  /** Valid, confirmed retirements */
  totalTonnesRetired: number;
  /** Purchased minus retired — credits not yet submitted for retirement */
  remainingInventory: number;
  /** Retired ÷ purchased × 100 — 0.0 to 100.0 */
  retirementCoverageRatioPct: number;
  /** Average USDC price paid per tonne across all purchases */
  avgPricePaidPerTonne: number | null;
  minPricePaidPerTonne: number | null;
  maxPricePaidPerTonne: number | null;
  /** Tonne breakdown by carbon standard / methodology */
  methodologyDistribution: MethodologyBreakdown[];
  /** Tonne breakdown by vintage year */
  vintageSpread: VintageBreakdown[];
  /** Time-period breakdown (granularity controlled by `period` param) */
  timePeriodBreakdown: TimePeriodBreakdown[];
  computedAt: string;
}
