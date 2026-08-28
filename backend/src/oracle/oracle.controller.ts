import { Controller, Get, Post, Param, Body, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { OracleService, SubmitMonitoringDto, UpdatePriceDto, FlagProjectDto } from "./oracle.service";

@Controller("oracle")
export class OracleController {
  constructor(private readonly oracleService: OracleService) {}

  @Post("monitoring")
  @UseGuards(AuthGuard("jwt"))
  submitMonitoring(@Body() dto: SubmitMonitoringDto) {
    return this.oracleService.submitMonitoring(dto);
  }

  /**
   * POST /oracle/price
   * Push a benchmark carbon credit price for a methodology + vintage year.
   * Cached in Redis with 5-minute TTL.
   * Requires oracle/admin JWT.
   */
  @Post("price")
  @UseGuards(AuthGuard("jwt"))
  async updatePrice(@Body() dto: UpdatePriceDto) {
    await this.oracleService.updateBenchmarkPrice(dto);
    return { received: true, methodology: dto.methodology, vintageYear: dto.vintageYear };
  }

  /**
   * GET /oracle/benchmark-price?methodology=VCS&vintage=2023
   * Retrieve the current cached benchmark carbon credit price.
   * Served from Redis (5-min TTL). Falls back to in-memory store if Redis unavailable.
   */
  @Get("benchmark-price")
  getBenchmarkPrice(
    @Query("methodology") methodology: string,
    @Query("vintage")     vintage: string,
  ) {
    return this.oracleService.getBenchmarkPrice(methodology, Number(vintage));
  }

  @Get("status/:projectId")
  getStatus(@Param("projectId") projectId: string) {
    return this.oracleService.getStatus(projectId);
  }

  @Post("flag")
  @UseGuards(AuthGuard("jwt"))
  flagProject(@Body() dto: FlagProjectDto) {
    return this.oracleService.flagProject(dto);
  }
}
