/**
 * Lightweight in-process Prometheus-compatible metrics registry.
 *
 * Exposes a single counter family:
 *   contract_calls_total{contract="primary"|"canary", status="success"|"error"}
 *
 * The /metrics endpoint (registered in main.ts) renders these in the standard
 * Prometheus text format so Grafana can scrape them without prom-client.
 */

export type ContractLabel = 'primary' | 'canary';
export type StatusLabel   = 'success' | 'error';

interface CounterKey {
  contract: ContractLabel;
  status:   StatusLabel;
}

/**
 * Singleton registry — one instance per process.
 */
class ContractCallsRegistry {
  private readonly counters = new Map<string, number>();

  private key(contract: ContractLabel, status: StatusLabel): string {
    return `${contract}:${status}`;
  }

  /** Increment the counter for a specific label combination. */
  increment(contract: ContractLabel, status: StatusLabel): void {
    const k = this.key(contract, status);
    this.counters.set(k, (this.counters.get(k) ?? 0) + 1);
  }

  /** Read the current value without modifying it. */
  get(contract: ContractLabel, status: StatusLabel): number {
    return this.counters.get(this.key(contract, status)) ?? 0;
  }

  /**
   * Render the registry as a Prometheus text-format string.
   *
   * Example output:
   *   # HELP contract_calls_total Total number of Soroban contract calls
   *   # TYPE contract_calls_total counter
   *   contract_calls_total{contract="primary",status="success"} 142
   *   contract_calls_total{contract="primary",status="error"} 3
   *   contract_calls_total{contract="canary",status="success"} 15
   *   contract_calls_total{contract="canary",status="error"} 2
   */
  toPrometheusText(): string {
    const lines: string[] = [
      '# HELP contract_calls_total Total number of Soroban contract calls by routing target and outcome',
      '# TYPE contract_calls_total counter',
    ];

    const contracts: ContractLabel[] = ['primary', 'canary'];
    const statuses:  StatusLabel[]   = ['success', 'error'];

    for (const contract of contracts) {
      for (const status of statuses) {
        const value = this.get(contract, status);
        lines.push(`contract_calls_total{contract="${contract}",status="${status}"} ${value}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /** Reset all counters (used in tests). */
  reset(): void {
    this.counters.clear();
  }
}

export const contractCallsRegistry = new ContractCallsRegistry();
