"use client";

import { useRetirement } from "../../../lib/api";
import RetirementCertificate from "../../../components/RetirementCertificate";
import { colors } from "../../../styles/design-system";

export default function RetirementCertificatePage({ params }: { params: { id: string } }) {
  // This is a server component — data fetched server-side for SEO and public access
  return <RetirementCertificateClient id={params.id} />;
}

function RetirementCertificateClient({ id }: { id: string }) {
  const { data: retirement, isLoading } = useRetirement(id);

  if (isLoading) return (
    <div style={{ textAlign: "center", padding: "4rem", color: colors.neutral[400] }}>
      Loading certificate…
    </div>
  );

  if (!retirement) return (
    <div style={{ textAlign: "center", padding: "4rem" }}>
      <p style={{ color: colors.neutral[500] }}>Certificate not found.</p>
      <p style={{ fontSize: "0.875rem", color: colors.neutral[400] }}>
        Retirement ID: {id}
      </p>
    </div>
  );

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <a href="/audit" style={{ fontSize: "0.875rem", color: colors.primary[600], textDecoration: "none" }}>
          ← Public Audit Trail
        </a>
        <p style={{ fontSize: "0.8rem", color: colors.neutral[400], margin: "0.5rem 0 0" }}>
          This certificate is permanently recorded on Stellar and publicly verifiable without a wallet.
        </p>
      </div>
      <RetirementCertificate retirement={retirement} />
    </div>
  );
}
