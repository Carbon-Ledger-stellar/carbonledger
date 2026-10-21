'use client';

import dynamic from "next/dynamic";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { colors } from "../styles/design-system";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CO2OffsetDataPoint {
  month: string;
  tonnes: number;
}

export interface PricingDataPoint {
  month: string;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
}

export interface MilestoneDataPoint {
  project: string;
  credits: number;
  status: "completed" | "in-progress" | "planned";
}

interface ImpactChartsProps {
  co2Data?: CO2OffsetDataPoint[];
  pricingData?: PricingDataPoint[];
  milestoneData?: MilestoneDataPoint[];
}

// ─── Default data (shown when API data is not yet available) ───────────────────

const DEFAULT_CO2_DATA: CO2OffsetDataPoint[] = [
  { month: "Jan", tonnes: 120 },
  { month: "Feb", tonnes: 200 },
  { month: "Mar", tonnes: 150 },
  { month: "Apr", tonnes: 310 },
  { month: "May", tonnes: 280 },
  { month: "Jun", tonnes: 420 },
];

const DEFAULT_PRICING_DATA: PricingDataPoint[] = [
  { month: "Jan", avgPrice: 12.5, minPrice: 10, maxPrice: 15 },
  { month: "Feb", avgPrice: 13.2, minPrice: 11, maxPrice: 16 },
  { month: "Mar", avgPrice: 11.8, minPrice: 9, maxPrice: 14 },
  { month: "Apr", avgPrice: 14.0, minPrice: 12, maxPrice: 17 },
  { month: "May", avgPrice: 15.5, minPrice: 13, maxPrice: 18 },
  { month: "Jun", avgPrice: 16.2, minPrice: 14, maxPrice: 19 },
];

const DEFAULT_MILESTONE_DATA: MilestoneDataPoint[] = [
  { project: "Amazon Reforestation", credits: 500, status: "completed" },
  { project: "Kenya Wind Farm", credits: 350, status: "completed" },
  { project: "Methane Capture", credits: 200, status: "in-progress" },
  { project: "Blue Carbon Project", credits: 150, status: "planned" },
];

// ─── Status colors ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e",
  "in-progress": "#3b82f6",
  planned: "#a855f7",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  "in-progress": "In Progress",
  planned: "Planned",
};

// ─── Shared tooltip styles (light/dark aware) ─────────────────────────────────

const tooltipContentStyle: React.CSSProperties = {
  backgroundColor: "var(--tooltip-bg, #fff)",
  border: "1px solid var(--tooltip-border, #e5e7eb)",
  borderRadius: "0.5rem",
  fontSize: "0.875rem",
  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
};

// ─── Skeleton fallback ─────────────────────────────────────────────────────────

function ChartSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={`Loading ${label}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        height: "300px",
        padding: "0.5rem 0",
      }}
    >
      <div
        style={{
          height: "1rem",
          width: "40%",
          borderRadius: "0.25rem",
          backgroundColor: "var(--skeleton-bg, #e5e7eb)",
          opacity: 0.6,
        }}
      />
      <div
        style={{
          flex: 1,
          borderRadius: "0.5rem",
          backgroundColor: "var(--skeleton-bg, #e5e7eb)",
          opacity: 0.4,
        }}
      />
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div
      role="img"
      aria-label={message}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "300px",
        color: "var(--text-secondary, #6b7280)",
        fontSize: "0.875rem",
      }}
    >
      {message}
    </div>
  );
}

// ─── Chart sections ────────────────────────────────────────────────────────────

function CO2OffsetChart({ data }: { data: CO2OffsetDataPoint[] }) {
  if (data.length === 0) {
    return <EmptyState message="No CO2 offset data available for selected period" />;
  }

  const summaryText = data
    .map((d) => `${d.month}: ${d.tonnes.toFixed(0)}t`)
    .join("; ");

  return (
    <div role="img" aria-label={`CO₂ offset over time. ${summaryText}`}>
      <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #1f2937)", margin: "0 0 1rem" }}>
        CO₂ Offset Over Time
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-color, #e5e7eb)" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12, fill: "var(--text-secondary, #6b7280)" }}
            aria-label="Month"
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--text-secondary, #6b7280)" }}
            aria-label="Tonnes CO₂e"
          />
          <Tooltip
            contentStyle={tooltipContentStyle}
            formatter={(value: number) => [`${value.toFixed(0)} tCO₂e`, "Offset"]}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="tonnes"
            stroke="#22c55e"
            strokeWidth={2}
            dot={{ r: 4, fill: "#22c55e" }}
            activeDot={{ r: 6 }}
            name="Tonnes Offset"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PricingTrendChart({ data }: { data: PricingDataPoint[] }) {
  if (data.length === 0) {
    return <EmptyState message="No pricing data available for selected period" />;
  }

  const summaryText = data
    .map((d) => `${d.month}: avg $${d.avgPrice.toFixed(1)}`)
    .join("; ");

  return (
    <div role="img" aria-label={`Historical pricing trends. ${summaryText}`}>
      <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #1f2937)", margin: "0 0 1rem" }}>
        Historical Pricing Trends
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-color, #e5e7eb)" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12, fill: "var(--text-secondary, #6b7280)" }}
            aria-label="Month"
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--text-secondary, #6b7280)" }}
            aria-label="Price (USDC)"
            tickFormatter={(v: number) => `$${v}`}
          />
          <Tooltip
            contentStyle={tooltipContentStyle}
            formatter={(value: number) => [`$${value.toFixed(2)}`, ""]}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="maxPrice"
            stroke="#f59e0b"
            fill="#f59e0b"
            fillOpacity={0.1}
            name="Max Price"
          />
          <Area
            type="monotone"
            dataKey="avgPrice"
            stroke="#3b82f6"
            fill="#3b82f6"
            fillOpacity={0.2}
            name="Avg Price"
          />
          <Area
            type="monotone"
            dataKey="minPrice"
            stroke="#22c55e"
            fill="#22c55e"
            fillOpacity={0.1}
            name="Min Price"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProjectMilestonesChart({ data }: { data: MilestoneDataPoint[] }) {
  if (data.length === 0) {
    return <EmptyState message="No project milestone data available" />;
  }

  return (
    <div role="img" aria-label="Project milestones by credit count">
      <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #1f2937)", margin: "0 0 1rem" }}>
        Project Milestones
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 20, left: 100, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid-color, #e5e7eb)" />
          <XAxis
            type="number"
            tick={{ fontSize: 12, fill: "var(--text-secondary, #6b7280)" }}
            aria-label="Credits"
          />
          <YAxis
            type="category"
            dataKey="project"
            tick={{ fontSize: 12, fill: "var(--text-secondary, #6b7280)" }}
            width={90}
            aria-label="Project"
          />
          <Tooltip
            contentStyle={tooltipContentStyle}
            formatter={(value: number, name: string, props: any) => [
              `${value} credits`,
              props?.payload?.status
                ? STATUS_LABELS[props.payload.status] ?? props.payload.status
                : name,
            ]}
          />
          <Legend />
          <Bar dataKey="credits" name="Credits" radius={[0, 4, 4, 0]}>
            {data.map((entry, index) => (
              <Bar
                key={`cell-${index}`}
                dataKey="credits"
                fill={STATUS_COLORS[entry.status] ?? "#3b82f6"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Lazy-loaded chart wrappers ────────────────────────────────────────────────
// Charts are code-split via next/dynamic so the recharts bundle is only fetched
// on routes that actually render them. ssr:false avoids hydration mismatches
// from ResponsiveContainer measuring the DOM on the client only.

const LazyCO2OffsetChart = dynamic(
  () => Promise.resolve({ default: CO2OffsetChart }),
  {
    ssr: false,
    loading: () => <ChartSkeleton label="CO₂ offset chart" />,
  }
);

const LazyPricingTrendChart = dynamic(
  () => Promise.resolve({ default: PricingTrendChart }),
  {
    ssr: false,
    loading: () => <ChartSkeleton label="pricing trend chart" />,
  }
);

const LazyProjectMilestonesChart = dynamic(
  () => Promise.resolve({ default: ProjectMilestonesChart }),
  {
    ssr: false,
    loading: () => <ChartSkeleton label="project milestones chart" />,
  }
);

// ─── Main component ────────────────────────────────────────────────────────────

export default function ImpactCharts({
  co2Data = DEFAULT_CO2_DATA,
  pricingData = DEFAULT_PRICING_DATA,
  milestoneData = DEFAULT_MILESTONE_DATA,
}: ImpactChartsProps) {
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
        gap: "1.5rem",
      }}
    >
      <LazyCO2OffsetChart data={co2Data} />
      <LazyPricingTrendChart data={pricingData} />
      <LazyProjectMilestonesChart data={milestoneData} />
    </div>
  );
}
