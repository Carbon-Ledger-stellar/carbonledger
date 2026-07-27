import { Global, Module } from "@nestjs/common";
import { LoggerService } from "./logger.service";
import { LogsController } from "./logs.controller";
import { AlertingService } from "./alerting.service";
import { MonitoringService } from "./monitoring.service";
import { DashboardController } from "./dashboard.controller";
import { PrismaService } from "../prisma.service";
import { CorrelationIdContext } from "./correlation-id.context";

@Global()
@Module({
  controllers: [LogsController, DashboardController],
  providers: [LoggerService, AlertingService, MonitoringService, PrismaService, CorrelationIdContext],
  exports: [LoggerService, AlertingService, MonitoringService, CorrelationIdContext],
})
export class LoggerModule {}
