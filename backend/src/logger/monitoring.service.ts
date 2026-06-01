import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { LoggerService } from "./logger.service";
import { AlertingService } from "./alerting.service";

export interface DashboardMetrics {
  activeListings: number;
  dailyRetirements: number;
  oracleStatus: {
    lastUpdate: Date | null;
    isHealthy: boolean;
    daysSinceUpdate: number;
  };
  sorobanMetrics: {
    successRate: number;
    failureCount: number;
    totalCount: number;
  };
}

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
    private readonly alerting: AlertingService,
  ) {}

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    try {
      const activeListings = await this.getActiveListingsCount();
      const dailyRetirements = await this.getDailyRetirementsCount();
      const oracleStatus = await this.getOracleStatus();
      const sorobanMetrics = await this.getSorobanMetrics();

      // Check for alerts
      if (oracleStatus.lastUpdate) {
        await this.alerting.checkOracleDataStaleness(oracleStatus.lastUpdate);
      }

      if (sorobanMetrics.totalCount > 0) {
        await this.alerting.checkSorobanSubmissionFailureRate(
          sorobanMetrics.failureCount,
          sorobanMetrics.totalCount,
          60,
        );
      }

      return {
        activeListings,
        dailyRetirements,
        oracleStatus,
        sorobanMetrics,
      };
    } catch (error) {
      this.logger.error(
        "Failed to get dashboard metrics",
        String(error),
        { error },
      );
      throw error;
    }
  }

  private async getActiveListingsCount(): Promise<number> {
    try {
      const count = await this.prisma.marketplace.count({
        where: {
          status: "active",
        },
      });
      return count;
    } catch (error) {
      this.logger.warn("Failed to count active listings", { error });
      return 0;
    }
  }

  private async getDailyRetirementsCount(): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const count = await this.prisma.retirement.count({
        where: {
          createdAt: {
            gte: today,
          },
        },
      });
      return count;
    } catch (error) {
      this.logger.warn("Failed to count daily retirements", { error });
      return 0;
    }
  }

  private async getOracleStatus(): Promise<{
    lastUpdate: Date | null;
    isHealthy: boolean;
    daysSinceUpdate: number;
  }> {
    try {
      const latestUpdate = await this.prisma.oracleUpdate.findFirst({
        orderBy: {
          createdAt: "desc",
        },
      });

      if (!latestUpdate) {
        return {
          lastUpdate: null,
          isHealthy: false,
          daysSinceUpdate: 999,
        };
      }

      const daysSinceUpdate = Math.floor(
        (Date.now() - latestUpdate.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      return {
        lastUpdate: latestUpdate.createdAt,
        isHealthy: daysSinceUpdate < 365,
        daysSinceUpdate,
      };
    } catch (error) {
      this.logger.warn("Failed to get oracle status", { error });
      return {
        lastUpdate: null,
        isHealthy: false,
        daysSinceUpdate: 999,
      };
    }
  }

  private async getSorobanMetrics(): Promise<{
    successRate: number;
    failureCount: number;
    totalCount: number;
  }> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const submissions = await this.prisma.sorobanSubmission.findMany({
        where: {
          createdAt: {
            gte: oneHourAgo,
          },
        },
      });

      if (submissions.length === 0) {
        return {
          successRate: 1,
          failureCount: 0,
          totalCount: 0,
        };
      }

      const failureCount = submissions.filter(
        (s) => s.status === "failed",
      ).length;
      const successRate = (submissions.length - failureCount) / submissions.length;

      return {
        successRate,
        failureCount,
        totalCount: submissions.length,
      };
    } catch (error) {
      this.logger.warn("Failed to get Soroban metrics", { error });
      return {
        successRate: 1,
        failureCount: 0,
        totalCount: 0,
      };
    }
  }

  async trackSorobanSubmission(
    contractId: string,
    status: "success" | "failed",
    error?: string,
  ): Promise<void> {
    try {
      await this.prisma.sorobanSubmission.create({
        data: {
          contractId,
          status,
          error,
        },
      });
    } catch (error) {
      this.logger.warn("Failed to track Soroban submission", { error });
    }
  }

  async trackOracleUpdate(
    dataType: string,
    success: boolean,
    error?: string,
  ): Promise<void> {
    try {
      await this.prisma.oracleUpdate.create({
        data: {
          dataType,
          success,
          error,
        },
      });
    } catch (error) {
      this.logger.warn("Failed to track oracle update", { error });
    }
  }
}
