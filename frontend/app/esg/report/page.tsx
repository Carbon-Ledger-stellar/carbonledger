"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import { useRetirements, exportEsgCsv, exportEsgPdf, EsgExportFilters } from "../../../lib/api";
import { colors } from "../../../styles/design-system";
import { EsgKpiCards } from "../../../components/EsgKpiCards";
import { EsgBarChart } from "../../../components/EsgBarChart";
import { EsgPieChart } from "../../../components/EsgPieChart";
import { EsgDateRangeFilter } from "../../../components/EsgDateRangeFilter";
import {
  filterByDateRange,
  aggregateBarChartData,
  aggregatePieChartData,
  aggregateKpiData,
  getAllMethodologies,
  getDefaultDateRange,
} from "../../../lib/esg-aggregation";

const METHODOLOGIES = ["", "VCS", "Gold Standard", "ACR", "CAR", "Plan Vivo"];
const COUNTRIES = ["", "Brazil", "Indonesia", "Kenya", "India", "Colombia", "Peru", "USA"];
const VINTAGES = ["", "2019", "2020", "2021", "2022", "2023", "2024"];

export default function EsgReportPage() {
  const { data: retirements = [] } = useRetirements(1000);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const defaultRange = useMemo(() => getDefaultDateRange(), []);

  const [dateRange, setDateRange] = useState({
    start: defaultRange.start,
    end: defaultRange.end,
  });

  const [filters, setFilters] = useState<EsgExportFilters>({
    methodology: "",
    country: "",
    vintageYear: undefined,
    startDate: "",
    endDate: "",
    beneficiary: "",
    minAmount: undefined,
    maxAmount: undefined,
    projectId: "",
    batchId: "",
  });

  const [exporting, setExporting] = useState(false);

  const filteredRetirements = useMemo(() => {
    return retirements.filter((r) => {
      if (filters.methodology && r.project?.methodology !== filters.methodology) return false;
      if (filters.country && r.project?.country !== filters.country) return false;
      if (filters.vintageYear && r.vintageYear !== filters.vintageYear) return false;
      if (filters.beneficiary && !r.beneficiary.toLowerCase().includes(filters.beneficiary.toLowerCase())) return false;
      if (filters.minAmount !== undefined && r.amount < filters.minAmount) return false;
      if (filters.maxAmount !== undefined && r.amount > filters.maxAmount) return false;
      if (filters.projectId && r.projectId !== filters.projectId) return false;
      if (filters.batchId && r.batchId !== filters.batchId) return false;
      if (filters.startDate && new Date(r.retiredAt) < new Date(filters.startDate)) return false;
      if (filters.endDate && new Date(r.retiredAt) > new Date(filters.endDate)) return false;
      return true;
    });
  }, [retirements, filters]);

  const dateFilteredRetirements = useMemo(() => {
    return filterByDateRange(filteredRetirements, dateRange.start, dateRange.end);
  }, [filteredRetirements, dateRange]);

  const barData = useMemo(
    () => aggregateBarChartData(dateFilteredRetirements),
    [dateFilteredRetirements]
  );

  const pieData = useMemo(
    () => aggregatePieChartData(dateFilteredRetirements),
    [dateFilteredRetirements]
  );

  const methodologies = useMemo(
    () => getAllMethodologies(dateFilteredRetirements),
    [dateFilteredRetirements]
  );

  const kpi = useMemo(
    () => aggregateKpiData(retirements, filteredRetirements),
    [retirements, filteredRetirements]
  );

  const handleExportPdfDashboard = useCallback(async () => {
    if (!dashboardRef.current || exporting) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      const canvas = await html2canvas(dashboardRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const pdf = new jsPDF("p", "mm", "a4");

      const title = "CarbonLedger ESG Report";
      const subtitle = `Generated ${new Date().toLocaleDateString()} | Period: ${dateRange.start} to ${dateRange.end}`;
      pdf.setFontSize(18);
      pdf.text(title, 105, 15, { align: "center" });
      pdf.setFontSize(10);
      pdf.text(subtitle, 105, 22, { align: "center" });

      const imgData = canvas.toDataURL("image/png");
      pdf.addImage(imgData, "PNG", 0, 30, imgWidth, imgHeight);

      pdf.save(`esg-dashboard-${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setExporting(false);
    }
  }, [dateRange, exporting]);

  const handleExportCsv = useCallback(async () => {
    const blob = await exportEsgCsv(filters);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `esg-retirements-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }, [filters]);

  const handleExportPdfReport = useCallback(async () => {
    const blob = await exportEsgPdf(filters);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `esg-report-${new Date().toISOString().split("T")[0]}.pdf`;
    a.click();
    window.URL.revokeObjectURL(url);
  }, [filters]);

  const resetDateRange = useCallback(() => {
    setDateRange({ start: defaultRange.start, end: defaultRange.end });
  }, [defaultRange]);

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <div
          style={{
            display: "inline-block",
            background: colors.primary[50],
            color: colors.primary[700],
            border: `1px solid ${colors.primary[200]}`,
            borderRadius: "9999px",
            padding: "0.3rem 1rem",
            fontSize: "0.8rem",
            fontWeight: 600,
            marginBottom: "1rem",
          }}
        >
          Regulatory Filing Ready
        </div>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 800,
            color: colors.neutral[900],
            margin: "0 0 0.5rem",
          }}
        >
          ESG Reporting Dashboard
        </h1>
        <p style={{ color: colors.neutral[500], margin: 0 }}>
          Visualize retirement history with charts and export reports for annual sustainability filings.
        </p>
      </div>

      {/* Date Range Filter */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.neutral[200]}`,
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
          marginBottom: "2rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <EsgDateRangeFilter
            startDate={dateRange.start}
            endDate={dateRange.end}
            onStartChange={(v) => setDateRange((prev) => ({ ...prev, start: v }))}
            onEndChange={(v) => setDateRange((prev) => ({ ...prev, end: v }))}
            onReset={resetDateRange}
          />
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              onClick={handleExportPdfDashboard}
              disabled={exporting}
              aria-label="Export dashboard as PDF"
              style={{
                background: colors.primary[700],
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "0.75rem 1.5rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: exporting ? "not-allowed" : "pointer",
                opacity: exporting ? 0.6 : 1,
              }}
            >
              {exporting ? "Exporting…" : "Export to PDF"}
            </button>
            <button
              onClick={handleExportCsv}
              aria-label="Export filtered retirements as CSV"
              style={{
                background: colors.primary[600],
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "0.75rem 1.5rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Export CSV ({filteredRetirements.length})
            </button>
            <button
              onClick={handleExportPdfReport}
              aria-label="Export PDF report from server"
              style={{
                background: "transparent",
                color: colors.neutral[600],
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
                padding: "0.75rem 1.5rem",
                fontSize: "0.875rem",
                cursor: "pointer",
              }}
            >
              PDF Report
            </button>
          </div>
        </div>
      </div>

      {/* Dashboard content captured for PDF */}
      <div ref={dashboardRef}>
        {/* KPI Cards */}
        <div className="esg-kpi-grid" style={{ marginBottom: "2rem" }}>
          <EsgKpiCards kpi={kpi} />
        </div>

        {/* Charts Row */}
        <div
          className="esg-charts-grid"
          style={{ marginBottom: "2rem" }}
        >
          <div
            style={{
              background: colors.surface,
              border: `1px solid ${colors.neutral[200]}`,
              borderRadius: "0.75rem",
              padding: "1.5rem",
            }}
          >
            <h2
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: colors.neutral[900],
                margin: "0 0 1rem",
              }}
            >
              Tonnes Retired Per Year
            </h2>
            <EsgBarChart data={barData} methodologies={methodologies} />
          </div>
          <div
            style={{
              background: colors.surface,
              border: `1px solid ${colors.neutral[200]}`,
              borderRadius: "0.75rem",
              padding: "1.5rem",
            }}
          >
            <h2
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: colors.neutral[900],
                margin: "0 0 1rem",
              }}
            >
              Retirement By Methodology
            </h2>
            <EsgPieChart data={pieData} />
          </div>
        </div>
      </div>

      {/* Filters + Table */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.neutral[200]}`,
          borderRadius: "0.75rem",
          padding: "1.5rem",
          marginBottom: "2rem",
        }}
      >
        <h2
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            color: colors.neutral[900],
            margin: "0 0 1rem",
          }}
        >
          Filter Retirements
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "1rem",
            marginBottom: "1rem",
          }}
        >
          <div>
            <label
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: colors.neutral[600],
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Methodology
            </label>
            <select
              style={{
                width: "100%",
                padding: "0.5rem",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
              }}
              value={filters.methodology}
              onChange={(e) => setFilters({ ...filters, methodology: e.target.value })}
            >
              {METHODOLOGIES.map((m) => (
                <option key={m} value={m}>
                  {m || "All"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: colors.neutral[600],
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Country
            </label>
            <select
              style={{
                width: "100%",
                padding: "0.5rem",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
              }}
              value={filters.country}
              onChange={(e) => setFilters({ ...filters, country: e.target.value })}
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c || "All"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: colors.neutral[600],
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Vintage Year
            </label>
            <select
              style={{
                width: "100%",
                padding: "0.5rem",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
              }}
              value={filters.vintageYear || ""}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  vintageYear: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            >
              {VINTAGES.map((v) => (
                <option key={v} value={v}>
                  {v || "All"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: colors.neutral[600],
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Beneficiary (contains)
            </label>
            <input
              type="text"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
              }}
              placeholder="Search..."
              value={filters.beneficiary}
              onChange={(e) => setFilters({ ...filters, beneficiary: e.target.value })}
            />
          </div>

          <div>
            <label
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: colors.neutral[600],
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Min Amount (tonnes)
            </label>
            <input
              type="number"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
              }}
              placeholder="0"
              value={filters.minAmount ?? ""}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  minAmount: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </div>

          <div>
            <label
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: colors.neutral[600],
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Max Amount (tonnes)
            </label>
            <input
              type="number"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
              }}
              placeholder="Any"
              value={filters.maxAmount ?? ""}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  maxAmount: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </div>

          <div>
            <label
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: colors.neutral[600],
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Start Date
            </label>
            <input
              type="date"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
              }}
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
            />
          </div>

          <div>
            <label
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: colors.neutral[600],
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              End Date
            </label>
            <input
              type="date"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
              }}
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
            />
          </div>

          <div>
            <label
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: colors.neutral[600],
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Project ID
            </label>
            <input
              type="text"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
              }}
              placeholder="Exact match"
              value={filters.projectId}
              onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}
            />
          </div>

          <div>
            <label
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                color: colors.neutral[600],
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Batch ID
            </label>
            <input
              type="text"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.375rem",
              }}
              placeholder="Exact match"
              value={filters.batchId}
              onChange={(e) => setFilters({ ...filters, batchId: e.target.value })}
            />
          </div>
        </div>

        <button
          onClick={() =>
            setFilters({
              methodology: "",
              country: "",
              vintageYear: undefined,
              startDate: "",
              endDate: "",
              beneficiary: "",
              minAmount: undefined,
              maxAmount: undefined,
              projectId: "",
              batchId: "",
            })
          }
          style={{
            background: "transparent",
            color: colors.neutral[600],
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.375rem",
            padding: "0.75rem 1.5rem",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          Clear Filters
        </button>
      </div>

      {/* Results Table */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.neutral[200]}`,
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "1rem", borderBottom: `1px solid ${colors.neutral[200]}` }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>
            Retirement Records ({filteredRetirements.length})
          </h2>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: colors.neutral[50], borderBottom: `2px solid ${colors.neutral[200]}` }}>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Date</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Beneficiary</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Project</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600, color: colors.neutral[700] }}>Tonnes</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Methodology</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Vintage</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {filteredRetirements.map((r, i) => (
                <tr
                  key={r.retirementId}
                  style={{
                    borderBottom: `1px solid ${colors.neutral[100]}`,
                    background: i % 2 === 0 ? "transparent" : colors.neutral[50],
                  }}
                >
                  <td style={{ padding: "0.75rem 1rem", color: colors.neutral[700] }}>
                    {new Date(r.retiredAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: 600, color: colors.neutral[900] }}>
                    {r.beneficiary}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", color: colors.neutral[700] }}>
                    {r.project?.name || r.projectId}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600, color: colors.neutral[900] }}>
                    {r.amount.toLocaleString()} tCO₂e
                  </td>
                  <td style={{ padding: "0.75rem 1rem", color: colors.neutral[700] }}>
                    {r.project?.methodology || "—"}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", color: colors.neutral[700] }}>
                    {r.vintageYear}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <a
                      href={`https://stellar.expert/explorer/public/tx/${r.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: colors.primary[600], fontSize: "0.8rem", wordBreak: "break-all" }}
                      title="View on Stellar Explorer"
                    >
                      {r.txHash.slice(0, 12)}…{r.txHash.slice(-8)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
