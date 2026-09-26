import { RetirementRecord } from "./api";

export interface BarChartData {
  year: string;
  [methodology: string]: string | number;
}

export interface PieChartData {
  name: string;
  value: number;
}

export interface KpiData {
  totalTonnesLifetime: number;
  totalTonnesThisYear: number;
  pendingCertificates: number;
}

const METHODOLOGY_COLORS: Record<string, string> = {
  VCS: "#16a34a",
  "Gold Standard": "#ca8a04",
  ACR: "#2563eb",
  CAR: "#9333ea",
  "Plan Vivo": "#ea580c",
};

export function getMethodologyColor(methodology: string): string {
  return METHODOLOGY_COLORS[methodology] || "#6b7280";
}

export function filterByDateRange(
  retirements: RetirementRecord[],
  startDate?: string,
  endDate?: string
): RetirementRecord[] {
  return retirements.filter((r) => {
    if (startDate && new Date(r.retiredAt) < new Date(startDate)) return false;
    if (endDate && new Date(r.retiredAt) > new Date(endDate)) return false;
    return true;
  });
}

export function aggregateBarChartData(
  retirements: RetirementRecord[]
): BarChartData[] {
  const yearMethodMap = new Map<string, Map<string, number>>();

  for (const r of retirements) {
    const year = new Date(r.retiredAt).getFullYear().toString();
    const methodology = r.project?.methodology || "Unknown";

    if (!yearMethodMap.has(year)) {
      yearMethodMap.set(year, new Map());
    }
    const methodMap = yearMethodMap.get(year)!;
    methodMap.set(methodology, (methodMap.get(methodology) || 0) + r.amount);
  }

  const sortedYears = Array.from(yearMethodMap.keys()).sort();
  const allMethodologies = new Set<string>();
  for (const methodMap of yearMethodMap.values()) {
    for (const m of methodMap.keys()) {
      allMethodologies.add(m);
    }
  }

  return sortedYears.map((year) => {
    const row: BarChartData = { year };
    const methodMap = yearMethodMap.get(year)!;
    for (const m of allMethodologies) {
      row[m] = methodMap.get(m) || 0;
    }
    return row;
  });
}

export function aggregatePieChartData(
  retirements: RetirementRecord[]
): PieChartData[] {
  const methodMap = new Map<string, number>();

  for (const r of retirements) {
    const methodology = r.project?.methodology || "Unknown";
    methodMap.set(methodology, (methodMap.get(methodology) || 0) + r.amount);
  }

  return Array.from(methodMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function aggregateKpiData(
  allRetirements: RetirementRecord[],
  filteredRetirements: RetirementRecord[]
): KpiData {
  const currentYear = new Date().getFullYear();
  const totalTonnesLifetime = allRetirements.reduce(
    (sum, r) => sum + r.amount,
    0
  );
  const totalTonnesThisYear = allRetirements
    .filter((r) => new Date(r.retiredAt).getFullYear() === currentYear)
    .reduce((sum, r) => sum + r.amount, 0);
  const pendingCertificates = filteredRetirements.filter(
    (r) => !r.batch || r.batch.status !== "retired"
  ).length;

  return { totalTonnesLifetime, totalTonnesThisYear, pendingCertificates };
}

export function getAllMethodologies(retirements: RetirementRecord[]): string[] {
  const methods = new Set<string>();
  for (const r of retirements) {
    if (r.project?.methodology) methods.add(r.project.methodology);
  }
  return Array.from(methods).sort();
}

export function getDefaultDateRange(): { start: string; end: string } {
  const now = new Date();
  const twoYearsAgo = new Date(now);
  twoYearsAgo.setFullYear(now.getFullYear() - 2);
  return {
    start: twoYearsAgo.toISOString().split("T")[0],
    end: now.toISOString().split("T")[0],
  };
}
