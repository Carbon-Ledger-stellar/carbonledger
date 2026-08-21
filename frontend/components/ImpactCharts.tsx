'use client';

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
import { colors } from "../../styles/design-system";

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
                ? STATUS_LABELS[props.payload.status] || props.payload.status
                : name,
            ]}
          />
          <Legend />
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <Bar
              key={status}
              dataKey={(d: MilestoneDataPoint) => (d.status === status ? d.credits : 0)}
              stackId="a"
              fill={color}
              name={STATUS_LABELS[status]}
              radius={[0, 4, 4, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function ImpactCharts({
  co2Data,
  pricingData,
  milestoneData,
}: ImpactChartsProps) {
  const isMobile = useIsMobile();

  const co2 = co2Data ?? DEFAULT_CO2_DATA;
  const pricing = pricingData ?? DEFAULT_PRICING_DATA;
  const milestones = milestoneData ?? DEFAULT_MILESTONE_DATA;

  const hasAnyData = co2.length > 0 || pricing.length > 0 || milestones.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "2rem",
        padding: isMobile ? "1rem" : "1.5rem",
        background: "var(--card-bg, #fff)",
        borderRadius: "1rem",
        border: "1px solid var(--card-border, #e5e7eb)",
      }}
    >
      <h2
        style={{
          fontSize: "1.25rem",
          fontWeight: 800,
          color: "var(--text-primary, #1f2937)",
          margin: 0,
        }}
      >
        Impact Metrics
      </h2>

      {!hasAnyData ? (
        <div
          style={{
            textAlign: "center",
            padding: "3rem 1rem",
            color: "var(--text-secondary, #6b7280)",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📊</div>
          <p style={{ fontSize: "0.875rem", margin: 0 }}>
            Impact data will appear here once credit activity is recorded.
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: "2rem",
            }}
          >
            <div
              style={{
                background: "var(--card-bg, #fff)",
                padding: "1rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--card-border, #e5e7eb)",
              }}
            >
              <CO2OffsetChart data={co2} />
            </div>
            <div
              style={{
                background: "var(--card-bg, #fff)",
                padding: "1rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--card-border, #e5e7eb)",
              }}
            >
              <PricingTrendChart data={pricing} />
            </div>
          </div>
          <div
            style={{
              background: "var(--card-bg, #fff)",
              padding: "1rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--card-border, #e5e7eb)",
            }}
          >
            <ProjectMilestonesChart data={milestones} />
          </div>
        </>
      )}
    </div>
  );
}