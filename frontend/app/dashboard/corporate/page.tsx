"use client";

import { useState } from "react";
import { colors, typography, spacing } from "../../styles/design-system";

interface PortfolioStats {
  totalHeld: number;
  totalRetired: number;
  pendingRetirements: number;
  usdcSpent: number;
}

interface HeldCredit {
  id: string;
  projectName: string;
  methodology: string;
  vintage: number;
  amount: number;
  pricePerTon: number;
}

interface PastRetirement {
  id: string;
  projectName: string;
  methodology: string;
  vintage: number;
  amount: number;
  retirementDate: string;
  certificateUrl?: string;
}

// Mock data - in real app, fetch from API
const mockStats: PortfolioStats = {
  totalHeld: 2500,
  totalRetired: 1500,
  pendingRetirements: 200,
  usdcSpent: 62500,
};

const mockHeldCredits: HeldCredit[] = [
  { id: "1", projectName: "Amazon Protection", methodology: "VCS", vintage: 2023, amount: 500, pricePerTon: 25 },
  { id: "2", projectName: "Wind Farm", methodology: "Gold Standard", vintage: 2022, amount: 300, pricePerTon: 30 },
  { id: "3", projectName: "Solar Project", methodology: "ACR", vintage: 2023, amount: 400, pricePerTon: 28 },
];

const mockPastRetirements: PastRetirement[] = [
  { id: "r1", projectName: "Forest Conservation", methodology: "VCS", vintage: 2021, amount: 200, retirementDate: "2024-01-15", certificateUrl: "#" },
  { id: "r2", projectName: "Mangrove Restoration", methodology: "Gold Standard", vintage: 2022, amount: 150, retirementDate: "2024-02-10", certificateUrl: "#" },
];

export default function CorporatePortfolioPage() {
  const [stats] = useState(mockStats);
  const [heldCredits] = useState(mockHeldCredits);
  const [pastRetirements] = useState(mockPastRetirements);

  const handleRetire = (creditId: string) => {
    // Implement retire logic
    console.log("Retire credit", creditId);
  };

  const handleDownloadCertificate = (retirementId: string) => {
    // Implement download logic
    console.log("Download certificate", retirementId);
  };

  const handleExportCSV = () => {
    // Implement CSV export
    console.log("Export to CSV");
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>Corporate Portfolio</h1>
        <button
          onClick={handleExportCSV}
          style={{
            background: colors.primary[600],
            color: "#fff",
            border: "none",
            borderRadius: "0.5rem",
            padding: "0.75rem 1.5rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Export as CSV
        </button>
      </div>

      {/* Summary Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1.5rem", marginBottom: "3rem" }}>
        <div style={{ background: colors.surface, border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.75rem", padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, color: colors.neutral[700], margin: "0 0 0.5rem" }}>Total Credits Held</h3>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>{stats.totalHeld.toLocaleString()} tCO₂e</p>
        </div>
        <div style={{ background: colors.surface, border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.75rem", padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, color: colors.neutral[700], margin: "0 0 0.5rem" }}>Total Retired</h3>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>{stats.totalRetired.toLocaleString()} tCO₂e</p>
        </div>
        <div style={{ background: colors.surface, border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.75rem", padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, color: colors.neutral[700], margin: "0 0 0.5rem" }}>Pending Retirements</h3>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>{stats.pendingRetirements.toLocaleString()} tCO₂e</p>
        </div>
        <div style={{ background: colors.surface, border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.75rem", padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, color: colors.neutral[700], margin: "0 0 0.5rem" }}>USDC Spent</h3>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>${stats.usdcSpent.toLocaleString()}</p>
        </div>
      </div>

      {/* Held Credits Table */}
      <div style={{ marginBottom: "3rem" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: colors.neutral[900], marginBottom: "1rem" }}>Held Credits</h2>
        <div style={{ background: colors.surface, border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.75rem", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: colors.neutral[50] }}>
                <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Project</th>
                <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Methodology</th>
                <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Vintage</th>
                <th style={{ padding: "1rem", textAlign: "right", fontWeight: 600, color: colors.neutral[700] }}>Amount</th>
                <th style={{ padding: "1rem", textAlign: "right", fontWeight: 600, color: colors.neutral[700] }}>Price/Ton</th>
                <th style={{ padding: "1rem", textAlign: "center", fontWeight: 600, color: colors.neutral[700] }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {heldCredits.map((credit) => (
                <tr key={credit.id} style={{ borderTop: `1px solid ${colors.neutral[200]}` }}>
                  <td style={{ padding: "1rem", color: colors.neutral[900] }}>{credit.projectName}</td>
                  <td style={{ padding: "1rem", color: colors.neutral[700] }}>{credit.methodology}</td>
                  <td style={{ padding: "1rem", color: colors.neutral[700] }}>{credit.vintage}</td>
                  <td style={{ padding: "1rem", textAlign: "right", color: colors.neutral[900] }}>{credit.amount.toLocaleString()} tCO₂e</td>
                  <td style={{ padding: "1rem", textAlign: "right", color: colors.neutral[900] }}>${credit.pricePerTon}</td>
                  <td style={{ padding: "1rem", textAlign: "center" }}>
                    <button
                      onClick={() => handleRetire(credit.id)}
                      style={{
                        background: colors.primary[600],
                        color: "#fff",
                        border: "none",
                        borderRadius: "0.375rem",
                        padding: "0.5rem 1rem",
                        fontSize: "0.875rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Retire
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Past Retirements Table */}
      <div>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: colors.neutral[900], marginBottom: "1rem" }}>Past Retirements</h2>
        <div style={{ background: colors.surface, border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.75rem", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: colors.neutral[50] }}>
                <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Project</th>
                <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Methodology</th>
                <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Vintage</th>
                <th style={{ padding: "1rem", textAlign: "right", fontWeight: 600, color: colors.neutral[700] }}>Amount</th>
                <th style={{ padding: "1rem", textAlign: "left", fontWeight: 600, color: colors.neutral[700] }}>Date</th>
                <th style={{ padding: "1rem", textAlign: "center", fontWeight: 600, color: colors.neutral[700] }}>Certificate</th>
              </tr>
            </thead>
            <tbody>
              {pastRetirements.map((retirement) => (
                <tr key={retirement.id} style={{ borderTop: `1px solid ${colors.neutral[200]}` }}>
                  <td style={{ padding: "1rem", color: colors.neutral[900] }}>{retirement.projectName}</td>
                  <td style={{ padding: "1rem", color: colors.neutral[700] }}>{retirement.methodology}</td>
                  <td style={{ padding: "1rem", color: colors.neutral[700] }}>{retirement.vintage}</td>
                  <td style={{ padding: "1rem", textAlign: "right", color: colors.neutral[900] }}>{retirement.amount.toLocaleString()} tCO₂e</td>
                  <td style={{ padding: "1rem", color: colors.neutral[700] }}>{new Date(retirement.retirementDate).toLocaleDateString()}</td>
                  <td style={{ padding: "1rem", textAlign: "center" }}>
                    <button
                      onClick={() => handleDownloadCertificate(retirement.id)}
                      style={{
                        background: colors.neutral[100],
                        color: colors.neutral[800],
                        border: `1px solid ${colors.neutral[300]}`,
                        borderRadius: "0.375rem",
                        padding: "0.5rem 1rem",
                        fontSize: "0.875rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Download
                    </button>
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