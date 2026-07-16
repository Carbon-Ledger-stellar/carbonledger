import { Injectable } from "@nestjs/common";
import axios from "axios";
import { LoggerService } from "./logger.service";

export interface Alert {
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp?: Date;
}

@Injectable()
export class AlertingService {
  private readonly webhookUrl = process.env.ADMIN_ALERT_WEBHOOK;
  private readonly sorobanFailureThreshold = 0.05; // 5%
  private readonly oracleStalenessDays = 30; // Alert if no data in 30 days

  constructor(private readonly logger: LoggerService) {}

  async sendAlert(alert: Alert): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.warn("Alert webhook not configured", {
        alert: alert.title,
      });
      return;
    }

    try {
      await axios.post(this.webhookUrl, {
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        context: alert.context,
        timestamp: alert.timestamp || new Date().toISOString(),
        service: "carbonledger-backend",
      });

      this.logger.log(`Alert sent: ${alert.title}`, {
        severity: alert.severity,
      });
    } catch (error) {
      this.logger.error(`Failed to send alert: ${alert.title}`, String(error), {
        alert: alert.title,
      });
    }
  }

  async checkOracleDataStaleness(
    lastUpdateTime: Date,
  ): Promise<void> {
    const daysSinceUpdate = Math.floor(
      (Date.now() - lastUpdateTime.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSinceUpdate >= this.oracleStalenessDays) {
      await this.sendAlert({
        severity: "warning",
        title: "Oracle Data Staleness Warning",
        message: `Oracle data has not been updated for ${daysSinceUpdate} days. Early warning before 365-day limit.`,
        context: {
          daysSinceUpdate,
          lastUpdateTime: lastUpdateTime.toISOString(),
          threshold: this.oracleStalenessDays,
        },
      });
    }
  }

  async checkSorobanSubmissionFailureRate(
    failureCount: number,
    totalCount: number,
    timeWindowMinutes: number = 60,
  ): Promise<void> {
    if (totalCount === 0) return;

    const failureRate = failureCount / totalCount;

    if (failureRate > this.sorobanFailureThreshold) {
      await this.sendAlert({
        severity: "critical",
        title: "Soroban Submission Failure Rate Exceeded",
        message: `Soroban submission failure rate is ${(failureRate * 100).toFixed(2)}% in the last ${timeWindowMinutes} minutes, exceeding 5% threshold.`,
        context: {
          failureCount,
          totalCount,
          failureRate: (failureRate * 100).toFixed(2),
          timeWindowMinutes,
          threshold: "5%",
        },
      });
    }
  }

  async checkAuthAnomaly(
    anomalyType: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.sendAlert({
      severity: "warning",
      title: `Authentication Anomaly Detected: ${anomalyType}`,
      message: `Unusual authentication activity detected. Review details for potential security issue.`,
      context: {
        anomalyType,
        ...details,
      },
    });
  }
}
