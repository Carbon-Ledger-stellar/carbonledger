import { Injectable } from "@nestjs/common";
import { LoggerService } from "./logger.service";
import { SlackService } from "./slack.service";

export interface Alert {
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp?: Date;
}

@Injectable()
export class AlertingService {
  private readonly sorobanFailureThreshold = 0.05; // 5%
  private readonly oracleStalenessDays = 30;

  constructor(
    private readonly logger: LoggerService,
    private readonly slack: SlackService,
  ) {}

  async sendAlert(alert: Alert): Promise<void> {
    this.logger.warn(`Alert: ${alert.title}`, { severity: alert.severity });
    // Delegate to SlackService which handles webhook config and Block Kit formatting
    await this.slack.notifyError({
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      context: alert.context,
    });
  }

  async checkOracleDataStaleness(lastUpdateTime: Date): Promise<void> {
    const daysSinceUpdate = Math.floor(
      (Date.now() - lastUpdateTime.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceUpdate >= this.oracleStalenessDays) {
      await this.sendAlert({
        severity: "warning",
        title: "Oracle Data Staleness Warning",
        message: `Oracle data has not been updated for ${daysSinceUpdate} days.`,
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
    timeWindowMinutes = 60,
  ): Promise<void> {
    if (totalCount === 0) return;
    const failureRate = failureCount / totalCount;
    if (failureRate > this.sorobanFailureThreshold) {
      await this.sendAlert({
        severity: "critical",
        title: "Soroban Submission Failure Rate Exceeded",
        message: `Failure rate is ${(failureRate * 100).toFixed(2)}% in the last ${timeWindowMinutes} minutes (threshold: 5%).`,
        context: { failureCount, totalCount, failureRate: `${(failureRate * 100).toFixed(2)}%`, timeWindowMinutes },
      });
    }
  }

  async checkAuthAnomaly(anomalyType: string, details: Record<string, unknown>): Promise<void> {
    await this.sendAlert({
      severity: "warning",
      title: `Authentication Anomaly: ${anomalyType}`,
      message: `Unusual authentication activity detected.`,
      context: { anomalyType, ...details },
    });
  }
}
