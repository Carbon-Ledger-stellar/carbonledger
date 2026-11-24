"use client";

import { useState, useEffect } from "react";
import { colors } from "../styles/design-system";

export interface Transaction {
  id: string;
  date: string;
  type: string;
  amount: string;
  status: string;
  description: string;
  price?: string;
  txHash?: string;
}

export function generateTransactionsCSV(transactions: Transaction[]): string {
  const headers = ["Date", "Type", "Amount", "Price", "Tx Hash", "Status", "Description"];
  const escapeCsv = (val: string = "") => {
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = transactions.map((t) =>
    [
      escapeCsv(t.date),
      escapeCsv(t.type),
      escapeCsv(t.amount),
      escapeCsv(t.price || "N/A"),
      escapeCsv(t.txHash || t.id),
      escapeCsv(t.status),
      escapeCsv(t.description),
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

interface Props {
  transactions?: Transaction[];
  isLoading?: boolean;
}

// Mock data
const mockTransactions: Transaction[] = [
  { id: "1", date: "2024-01-15", type: "Purchase", amount: "500 tCO₂e", status: "Completed", description: "Amazon Protection Project" },
  { id: "2", date: "2024-01-10", type: "Retirement", amount: "200 tCO₂e", status: "Verified", description: "Forest Conservation" },
  { id: "3", date: "2024-01-05", type: "Sale", amount: "300 tCO₂e", status: "Pending", description: "Carbon Credits Sale" },
];

function TransactionSkeleton() {
  return (
    <tr>
      <td style={{ padding: "1rem" }}>
        <div style={{
          height: "16px",
          background: `linear-gradient(90deg, ${colors.neutral[100]} 25%, ${colors.neutral[200]} 50%, ${colors.neutral[100]} 75%)`,
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          borderRadius: "0.25rem",
        }} />
      </td>
      <td style={{ padding: "1rem" }}>
        <div style={{
          height: "16px",
          width: "80px",
          background: `linear-gradient(90deg, ${colors.neutral[100]} 25%, ${colors.neutral[200]} 50%, ${colors.neutral[100]} 75%)`,
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          borderRadius: "0.25rem",
        }} />
      </td>
      <td style={{ padding: "1rem" }}>
        <div style={{
          height: "16px",
          width: "100px",
          background: `linear-gradient(90deg, ${colors.neutral[100]} 25%, ${colors.neutral[200]} 50%, ${colors.neutral[100]} 75%)`,
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          borderRadius: "0.25rem",
        }} />
      </td>
      <td style={{ padding: "1rem" }}>
        <div style={{
          height: "16px",
          width: "60px",
          background: `linear-gradient(90deg, ${colors.neutral[100]} 25%, ${colors.neutral[200]} 50%, ${colors.neutral[100]} 75%)`,
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          borderRadius: "0.25rem",
        }} />
      </td>
      <td style={{ padding: "1rem" }}>
        <div style={{
          height: "20px",
          width: "80px",
          background: `linear-gradient(90deg, ${colors.neutral[100]} 25%, ${colors.neutral[200]} 50%, ${colors.neutral[100]} 75%)`,
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          borderRadius: "9999px",
        }} />
      </td>
    </tr>
  );
}

export default function TransactionHistory({ transactions = mockTransactions, isLoading = false }: Props) {
  const [loading, setLoading] = useState(isLoading);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (isLoading) {
      // Simulate loading
      const timer = setTimeout(() => setLoading(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  const handleExportCSV = async () => {
    if (!transactions || transactions.length === 0) return;
    setIsExporting(true);
    try {
      // Yield to the event loop so the UI does not freeze on large histories
      await new Promise((resolve) => setTimeout(resolve, 0));
      const csvContent = generateTransactionsCSV(transactions);
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `transaction-history-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.75rem", overflow: "hidden" }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "1rem",
        borderBottom: `1px solid ${colors.neutral[200]}`,
        background: colors.neutral[50]
      }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: colors.neutral[900] }}>
          Transaction History
        </h3>
        <button
          onClick={handleExportCSV}
          disabled={isExporting || loading || transactions.length === 0}
          aria-label="Export CSV"
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            borderRadius: "0.375rem",
            border: `1px solid ${colors.neutral[300]}`,
            background: colors.surface,
            color: colors.neutral[700],
            cursor: isExporting || loading || transactions.length === 0 ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            transition: "all 0.2s ease",
          }}
        >
          {isExporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: colors.neutral[50] }}>
            <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Date</th>
            <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Type</th>
            <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Description</th>
            <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Amount</th>
            <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            // Skeleton rows
            <>
              <TransactionSkeleton />
              <TransactionSkeleton />
              <TransactionSkeleton />
              <TransactionSkeleton />
              <TransactionSkeleton />
            </>
          ) : (
            transactions.map((transaction) => (
              <tr key={transaction.id} style={{ borderTop: `1px solid ${colors.neutral[200]}` }}>
                <td style={{ padding: "1rem", color: colors.neutral[900] }}>{new Date(transaction.date).toLocaleDateString()}</td>
                <td style={{ padding: "1rem", color: colors.neutral[700] }}>{transaction.type}</td>
                <td style={{ padding: "1rem", color: colors.neutral[900] }}>{transaction.description}</td>
                <td style={{ padding: "1rem", color: colors.neutral[900] }}>{transaction.amount}</td>
                <td style={{ padding: "1rem" }}>
                  <span style={{
                    display: "inline-block",
                    background: transaction.status === "Completed" ? colors.verified.bg : transaction.status === "Pending" ? colors.pending.bg : colors.completed.bg,
                    color: transaction.status === "Completed" ? colors.verified.text : transaction.status === "Pending" ? colors.pending.text : colors.completed.text,
                    border: `1px solid ${transaction.status === "Completed" ? colors.verified.border : transaction.status === "Pending" ? colors.pending.border : colors.completed.border}`,
                    borderRadius: "9999px",
                    padding: "0.25rem 0.75rem",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                  }}>
                    {transaction.status}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {/* Add aria-busy for accessibility */}
      <div aria-busy={loading} style={{ display: "none" }} />
    </div>
  );
}