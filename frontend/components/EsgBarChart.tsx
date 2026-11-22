'use client';

import { useId, useState } from "react";
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
  const tableId = useId();
  const [tableVisible, setTableVisible] = useState(false);

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
    <div>
      <div
        role="img"
        aria-label={`Bar chart: tonnes retired per year by methodology. ${summaryText}`}
        aria-describedby={tableId}
      >
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
      </div>

      {/* Toggle button for visible data table */}
      <button
        type="button"
        onClick={() => setTableVisible((v) => !v)}
        aria-expanded={tableVisible}
        aria-controls={tableId}
        style={{
          marginTop: "0.5rem",
          background: "none",
          border: "1px solid #d1d5db",
          borderRadius: "0.375rem",
          padding: "0.25rem 0.75rem",
          fontSize: "0.75rem",
          color: "#4b5563",
          cursor: "pointer",
        }}
      >
        {tableVisible ? "Hide data table" : "Show data table"}
      </button>

      {/* Accessible data table — visible when toggled, always available to assistive tech */}
      <table
        id={tableId}
        aria-label="Tonnes retired per year by methodology"
        style={
          tableVisible
            ? {
                borderCollapse: "collapse",
                fontSize: "0.75rem",
                marginTop: "0.75rem",
                width: "100%",
              }
            : {
                position: "absolute",
                width: "1px",
                height: "1px",
                padding: 0,
                margin: "-1px",
                overflow: "hidden",
                clipPath: "inset(50%)",
                whiteSpace: "nowrap",
                border: 0,
              }
        }
      >
        <caption style={tableVisible ? { textAlign: "left", marginBottom: "0.4rem", fontWeight: 600 } : { display: "none" }}>
          Tonnes retired per year by methodology
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ padding: "0.3rem 0.5rem", textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Year</th>
            {methodologies.map((m) => (
              <th key={m} scope="col" style={{ padding: "0.3rem 0.5rem", textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.year}>
              <td style={{ padding: "0.3rem 0.5rem" }}>{d.year}</td>
              {methodologies.map((m) => (
                <td key={m} style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>{(d[m] as number).toFixed(1)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
