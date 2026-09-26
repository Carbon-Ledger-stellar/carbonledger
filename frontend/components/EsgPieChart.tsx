'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { PieChartData, getMethodologyColor } from "../lib/esg-aggregation";

interface Props {
  data: PieChartData[];
}

export function EsgPieChart({ data }: Props) {
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
    <div role="img" aria-label={`Pie chart: retirement breakdown by methodology. ${summaryText}`}>
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

      {/* Accessible data table fallback */}
      <table
        aria-label="Retirement breakdown by methodology"
        style={{
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
        <caption>Retirement breakdown by methodology</caption>
        <thead>
          <tr>
            <th scope="col">Methodology</th>
            <th scope="col">Tonnes</th>
            <th scope="col">Percentage</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.name}>
              <td>{d.name}</td>
              <td>{d.value.toFixed(1)}</td>
              <td>{((d.value / total) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
