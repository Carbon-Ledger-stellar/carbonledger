'use client';

import { useId, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { PieChartData, getMethodologyColor } from "../lib/esg-aggregation";

interface Props {
  data: PieChartData[];
}

export function EsgPieChart({ data }: Props) {
  const tableId = useId();
  const [tableVisible, setTableVisible] = useState(false);

  if (data.length === 0) {
    return (
      <div
        role="img"
        aria-label="Pie chart showing retirement breakdown by methodology. No data available for the selected date range."
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

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const summaryText = data
    .map((d) => `${d.name}: ${((d.value / total) * 100).toFixed(1)}%`)
    .join(", ");

  return (
    <div>
      <div
        role="img"
        aria-label={`Pie chart: retirement breakdown by methodology. ${summaryText}`}
        aria-describedby={tableId}
      >
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={true}
              label={({ name, percent }) =>
                `${name} ${(percent * 100).toFixed(0)}%`
              }
              outerRadius={100}
              dataKey="value"
              aria-label="Methodology breakdown"
            >
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={getMethodologyColor(entry.name)}
                  stroke="#fff"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => [
                `${value.toFixed(1)} tCO₂e`,
                "Tonnes",
              ]}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
              }}
            />
            <Legend />
          </PieChart>
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
        aria-label="Retirement breakdown by methodology"
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
          Retirement breakdown by methodology
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ padding: "0.3rem 0.5rem", textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Methodology</th>
            <th scope="col" style={{ padding: "0.3rem 0.5rem", textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Tonnes</th>
            <th scope="col" style={{ padding: "0.3rem 0.5rem", textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Percentage</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.name}>
              <td style={{ padding: "0.3rem 0.5rem" }}>{d.name}</td>
              <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>{d.value.toFixed(1)}</td>
              <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>{((d.value / total) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
