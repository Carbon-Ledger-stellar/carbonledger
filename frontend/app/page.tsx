"use client";

import { usePlatformStats, useRetirements } from "../lib/api";
import { formatTonnes, formatStroops } from "../lib/carbon-utils";
import { colors } from "../styles/design-system";
import LoadingSkeleton from "../components/LoadingSkeleton";
import ThemeToggle from "../components/ThemeToggle";

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.neutral[200]}`,
      borderRadius: "0.75rem",
      padding: "1.5rem",
      boxShadow: "0 1px 3px rgb(0 0 0 / 0.06)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: "0.8rem", color: colors.neutral[500], margin: "0 0 0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {label}
          </p>
          <p style={{ fontSize: "1.75rem", fontWeight: 800, color: colors.neutral[900], margin: 0 }}>{value}</p>
          {sub && <p style={{ fontSize: "0.8rem", color: colors.neutral[400], margin: "0.25rem 0 0" }}>{sub}</p>}
        </div>
        <span style={{ fontSize: "2rem" }}>{icon}</span>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { data: stats, isLoading: statsLoading } = usePlatformStats();
  const { data: retirements, isLoading: retLoading } = useRetirements(10);

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "3rem 2rem" }}>
      {/* Theme Toggle */}
      <div style={{ position: "fixed", top: "1rem", right: "1rem", zIndex: 50 }}>
        <ThemeToggle />
      </div>

      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: "4rem" }}>
        <div style={{
          display: "inline-block",
          background: colors.primary[50],
          color: colors.primary[700],
          border: `1px solid ${colors.primary[200]}`,
          borderRadius: "9999px",
          padding: "0.3rem 1rem",
          fontSize: "0.8rem",
          fontWeight: 600,
          marginBottom: "1.5rem",
        }}>
          Built on Stellar · Zero fraud · Full provenance
        </div>
        <h1 style={{ fontSize: "3.5rem", fontWeight: 900, color: colors.neutral[900], margin: "0 0 1rem", lineHeight: 1.1 }}>
          Verified Carbon Credits.<br />
          <span style={{ color: colors.primary[600] }}>Permanent Retirement.</span>
        </h1>
        <p style={{ fontSize: "1.1rem", color: colors.neutral[600], maxWidth: "600px", margin: "0 auto 2rem" }}>
          Every carbon credit has a complete audit trail from project registration to satellite monitoring to retirement.
          No fraud. No double-counting. No greenwashing.
        </p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
          <a href="/marketplace" style={{
            background: colors.primary[600], color: "#fff",
            borderRadius: "0.5rem", padding: "0.875rem 2rem",
            fontSize: "1rem", fontWeight: 700, textDecoration: "none",
          }}>
            Browse Carbon Credits
          </a>
          <a href="/audit" style={{
            background: "transparent", color: colors.primary[700],
            border: `1px solid ${colors.primary[300]}`,
            borderRadius: "0.5rem", padding: "0.875rem 2rem",
            fontSize: "1rem", fontWeight: 600, textDecoration: "none",
          }}>
            Public Audit Trail
          </a>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1.5rem", marginBottom: "4rem" }}>
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => <LoadingSkeleton key={i} variant="PoolStats" />)
        ) : (
          <>
            <StatCard label="Credits Issued"   value={formatTonnes(stats?.totalCreditsIssued ?? 0)}   icon="🌱" sub="Total CO₂e tokenized" />
            <StatCard label="Credits Retired"  value={formatTonnes(stats?.totalCreditsRetired ?? 0)}  icon="🔒" sub="Permanently retired on-chain" />
            <StatCard label="Active Projects"  value={String(stats?.activeProjects ?? 0)}             icon="🌍" sub="Verified projects" />
            <StatCard label="Market Volume"    value={`$${formatStroops(stats?.marketplaceVolume ?? "0")} USDC`} icon="💹" sub="Total traded" />
          </>
        )}
      </div>

      {/* Real-time retirement feed */}
      <div>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 1.5rem" }}>
          Live Retirement Feed
        </h2>
        <p style={{ fontSize: "0.875rem", color: colors.neutral[500], margin: "-1rem 0 1.5rem" }}>
          Every retirement is permanent and publicly verifiable on Stellar.
        </p>

        {retLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {Array.from({ length: 5 }).map((_, i) => <LoadingSkeleton key={i} variant="MarketplaceItem" />)}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {(retirements ?? []).map(r => (
              <a key={r.retirementId} href={`/retire/${r.retirementId}`} style={{ textDecoration: "none" }}>
                <div style={{
                  background: colors.surface,
                  border: `1px solid ${colors.neutral[200]}`,
                  borderRadius: "0.5rem",
                  padding: "1rem 1.25rem",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  transition: "border-color 0.15s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <span style={{
                      background: colors.primary[100],
                      color: colors.primary[700],
                      borderRadius: "50%",
                      width: "2.5rem", height: "2.5rem",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "1.1rem", flexShrink: 0,
                    }}>🔒</span>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: "0.9rem", color: colors.neutral[900], margin: 0 }}>
                        {r.beneficiary}
                      </p>
                      <p style={{ fontSize: "0.8rem", color: colors.neutral[500], margin: "0.1rem 0 0" }}>
                        {r.projectId} · {r.vintageYear} Vintage
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontWeight: 800, fontSize: "1rem", color: colors.primary[700], margin: 0 }}>
                      {formatTonnes(r.amount)}
                    </p>
                    <p style={{ fontSize: "0.75rem", color: colors.neutral[400], margin: "0.1rem 0 0" }}>
                      {new Date(r.retiredAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
