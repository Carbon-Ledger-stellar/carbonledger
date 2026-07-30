import { formatStroops, parseStroops } from "./stellar";

export { formatStroops, parseStroops };

/** Calculate total cost in USDC stroops for a given amount and price per credit. */
export function calculateCreditCost(amount: number, pricePerCreditStroops: bigint): bigint {
  return BigInt(amount) * pricePerCreditStroops;
}

/** Format a tonne amount with CO2e suffix. */
export function formatTonnes(tonnes: number | bigint): string {
  const n = Number(tonnes);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M tCO₂e`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K tCO₂e`;
  return `${n.toLocaleString()} tCO₂e`;
}

/** Generate a deterministic retirement ID from batch + timestamp. */
export function generateRetirementId(batchId: string, timestamp: number): string {
  return `ret-${batchId}-${timestamp}`;
}

/** Generate a batch ID from project + vintage + sequence. */
export function generateBatchId(projectId: string, vintageYear: number, seq: number): string {
  return `batch-${projectId}-${vintageYear}-${String(seq).padStart(4, "0")}`;
}

/** Validate that serial_end >= serial_start and range is non-zero. */
export function validateSerialRange(start: bigint, end: bigint): boolean {
  return end >= start && start > 0n;
}

/** Format vintage year as "2023 Vintage". */
export function formatVintageYear(year: number): string {
  return `${year} Vintage`;
}

/** Convert tonnes CO2e to equivalent metrics for display. */
export function calculateCO2Equivalent(tonnes: number): {
  cars: number;
  flights: number;
  homes: number;
} {
  return {
    cars:    Math.round(tonnes / 4.6),    // avg US car = 4.6 tCO2/year
    flights: Math.round(tonnes / 0.255),  // avg transatlantic flight = 0.255 tCO2
    homes:   Math.round(tonnes / 7.5),    // avg US home = 7.5 tCO2/year
  };
}

/** Format USDC amount from stroops for display. */
export function formatUSDC(stroops: bigint | number | string): string {
  return `$${formatStroops(stroops)} USDC`;
}
