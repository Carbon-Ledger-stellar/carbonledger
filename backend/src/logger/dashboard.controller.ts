import { Controller, Get } from "@nestjs/common";
import { MonitoringService, DashboardMetrics } from "./monitoring.service";

@Controller("api/v1/observability")
export class DashboardController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get("metrics")
  async getMetrics(): Promise<DashboardMetrics> {
    return this.monitoring.getDashboardMetrics();
  }
}
