'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { BarChartData, getMethodologyColor } from "../lib/esg-aggregation";

interface Props {
  data: BarChartData[];
  methodologies: string[];
}

export function EsgBarChart({ data, methodologies }: Props) {
  if (data.length === 0) {
    return (
      <div
        role="img"
        aria-label="Bar chart showing tonnes retired per year by methodology. No data available for the selected date range."
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "300px",
          color: "#6b7280",
          fontSize: "0.875rem",
        }}
      >
        No data available for selected period
      </div>
    );
  }

  const summaryText = data
    .map((d) => {
      const methods = methodologies
        .filter((m) => (d[m] as number) > 0)
        .map((m) => `${m}: ${(d[m] as number).toFixed(1)}t`);
      return `${d.year}: ${methods.join(", ") || "0t"}`;
    })
    .join("; ");

  return (
    <div role="img" aria-label={`Bar chart: tonnes retired per year by methodology. ${summaryText}`}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 12, fill: "#6b7280" }}
            aria-label="Year"
          />
          <YAxis
            tick={{ fontSize: 12, fill: "#6b7280" }}
            aria-label="Tonnes CO2e"
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
            }}
            formatter={(value: number, name: string) => [
              `${value.toFixed(1)} tCO₂e`,
              name,
            ]}
          />
          <Legend />
          {methodologies.map((m) => (
            <Bar
              key={m}
              dataKey={m}
              fill={getMethodologyColor(m)}
              radius={[4, 4, 0, 0]}
              aria-label={`${m} methodology`}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/* Accessible data table fallback */}
      <table
        aria-label="Tonnes retired per year by methodology"
        style={{
          borderCollapse: "collapse",
          fontSize: "0.75rem",
          marginTop: "1rem",
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          border: 0,
        }}
      >
        <caption>Tonnes retired per year by methodology</caption>
        <thead>
          <tr>
            <th scope="col">Year</th>
            {methodologies.map((m) => (
              <th key={m} scope="col">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.year}>
              <td>{d.year}</td>
              {methodologies.map((m) => (
                <td key={m}>{(d[m] as number).toFixed(1)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
