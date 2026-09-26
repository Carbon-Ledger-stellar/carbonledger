import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { PortfolioService } from './portfolio.service';
import { PortfolioMetricsQueryDto, TimePeriod } from './portfolio.dto';

/**
 * PortfolioController
 *
 * Exposes portfolio-level carbon metrics for corporate buyers:
 *
 *   GET /portfolio/metrics?address=GABC...&period=year
 *
 * Returns all 7 metrics in a single JSON response:
 *   1. Total tonnes purchased
 *   2. Total tonnes retired
 *   3. Remaining inventory
 *   4. Methodology distribution
 *   5. Vintage year spread
 *   6. Average price paid per tonne
 *   7. Retirement coverage ratio
 *
 * Requires the `address` query param.  Results are cached for 120 s and
 * backed by PostgreSQL materialized views for sub-200 ms response times
 * on portfolios of up to 10,000 credits.
 */
@ApiTags('portfolio')
@Controller('portfolio')
export class PortfolioController {
  private readonly logger = new Logger(PortfolioController.name);

  constructor(private readonly portfolioService: PortfolioService) {}

  /**
   * GET /portfolio/metrics
   *
   * Query params:
   *   address  (required) — Stellar wallet address of the corporate buyer
   *   period   (optional) — "month" | "quarter" | "year" (default: "year")
   */
  @Get('metrics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Portfolio carbon metrics',
    description:
      'Returns aggregated carbon metrics for a corporate buyer: total purchased, ' +
      'retired, inventory, methodology distribution, vintage spread, average price, ' +
      'and retirement coverage ratio.  Results are backed by materialized views and ' +
      'cached in Redis for 120 seconds.',
  })
  @ApiQuery({ name: 'address', required: true,  description: 'Stellar wallet address of the buyer' })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['month', 'quarter', 'year'],
    description: 'Time-period granularity for the breakdown (default: year)',
  })
  @ApiResponse({
    status: 200,
    description: 'Portfolio metrics computed successfully',
  })
  @ApiResponse({ status: 400, description: 'Missing or invalid query parameters' })
  async getMetrics(@Query() query: PortfolioMetricsQueryDto) {
    const { address, period = 'year' } = query;

    if (!address || typeof address !== 'string' || address.trim() === '') {
      throw new BadRequestException('address query parameter is required');
    }

    const validPeriods: TimePeriod[] = ['month', 'quarter', 'year'];
    if (!validPeriods.includes(period)) {
      throw new BadRequestException(`period must be one of: ${validPeriods.join(', ')}`);
    }

    this.logger.log(`Portfolio metrics request: address=${address} period=${period}`);

    return this.portfolioService.getMetrics(address.trim(), period);
  }

  /**
   * POST /portfolio/refresh-views
   *
   * Manually trigger a materialized view refresh.
   * Intended for admin use or post-deployment warm-up.
   * In production this is also triggered automatically by scheduled tasks.
   */
  @Get('refresh-views')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh portfolio materialized views',
    description: 'Triggers a CONCURRENT refresh of all four portfolio materialized views.',
  })
  @ApiResponse({ status: 200, description: 'Views refreshed successfully' })
  async refreshViews() {
    await this.portfolioService.refreshMaterializedViews();
    return { refreshed: true, timestamp: new Date().toISOString() };
  }
}
