"use client";

import { useState, useEffect } from "react";
import { colors } from "../styles/design-system";

interface Transaction {
  id: string;
  date: string;
  type: string;
  amount: string;
  status: string;
  description: string;
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

  useEffect(() => {
    if (isLoading) {
      // Simulate loading
      const timer = setTimeout(() => setLoading(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.75rem", overflow: "hidden" }}>
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