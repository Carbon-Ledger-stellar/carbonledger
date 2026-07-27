"use client";

import { useSearchParams } from "next/navigation";
import { useRetirement } from "../../../lib/api";
import RetirementCertificate from "../../../components/RetirementCertificate";
import RetirementSuccessState from "../../../components/RetirementSuccessState";
import LoadingSkeleton from "../../../components/LoadingSkeleton";
import { colors } from "../../../styles/design-system";

export default function RetirementCertificatePage({ params }: { params: { id: string } }) {
  return <RetirementCertificateClient id={params.id} />;
}

function RetirementCertificateClient({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";
  const { data: retirement, isLoading } = useRetirement(id);

  if (isLoading) return (
    <div style={{ maxWidth: "1000px", margin: "2.5rem auto", padding: "0 2rem" }}>
      <LoadingSkeleton variant="Certificate" />
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

  const publicUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/certificate/${retirement.retirementId}`;

  async function handleDownload() {
    const { default: jsPDF }       = await import("jspdf");
    const { default: html2canvas } = await import("html2canvas");
    const el = document.getElementById("retirement-certificate-print");
    if (!el) return;
    const canvas  = await html2canvas(el, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL("image/png");
    const pdf     = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    pdf.addImage(imgData, "PNG", 0, 0, 210, 297);
    pdf.save(`CarbonLedger-Certificate-${retirement.retirementId}.pdf`);
  }

  // Show celebratory success state right after retirement
  if (isNew) {
    return (
      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2.5rem 2rem" }}>
        <RetirementSuccessState retirement={retirement} onDownload={handleDownload} />
        <div style={{ marginTop: "2.5rem" }} id="retirement-certificate-print">
          <RetirementCertificate retirement={retirement} publicUrl={publicUrl} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <a href="/audit" style={{ fontSize: "0.875rem", color: colors.primary[600], textDecoration: "none" }}>
          ← Public Audit Trail
        </a>
        <p style={{ fontSize: "0.8rem", color: colors.neutral[400], margin: "0.5rem 0 0" }}>
          This certificate is permanently recorded on Stellar and publicly verifiable without a wallet.
          Permanent URL: <code style={{ fontSize: "0.75rem" }}>/api/certificate/{retirement.retirementId}</code>
        </p>
      </div>
      <div id="retirement-certificate-print">
        <RetirementCertificate retirement={retirement} publicUrl={publicUrl} />
      </div>
    </div>
  );
}
