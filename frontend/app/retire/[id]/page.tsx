"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  useRetirement,
  generateZkProof,
  fetchZkProof,
  type PrivateZkCertificate,
} from "../../../lib/api";
import RetirementCertificate from "../../../components/RetirementCertificate";
import RetirementSuccessState from "../../../components/RetirementSuccessState";
import LoadingSkeleton from "../../../components/LoadingSkeleton";
import { colors } from "../../../styles/design-system";

export default function RetirementCertificatePage({ params }: { params: { id: string } }) {
  return <RetirementCertificateClient id={params.id} />;
}

function RetirementCertificateClient({ id }: { id: string }) {
  const t = useTranslations("retireCertificatePage");
  const searchParams = useSearchParams();
  const isNew = searchParams.get("new") === "1";
  const { data: retirement, isLoading } = useRetirement(id);
  const [zkCert, setZkCert] = useState<PrivateZkCertificate | null>(null);
  const [zkBusy, setZkBusy] = useState(false);
  const [zkError, setZkError] = useState<string | null>(null);

  if (isLoading) return (
    <div style={{ maxWidth: "1000px", margin: "2.5rem auto", padding: "0 2rem" }}>
      <LoadingSkeleton variant="Certificate" />
    </div>
  );

  if (!retirement) return (
    <div style={{ textAlign: "center", padding: "4rem" }}>
      <p style={{ color: colors.neutral[500] }}>{t("notFound")}</p>
      <p style={{ fontSize: "0.875rem", color: colors.neutral[400] }}>
        {t("retirementIdLabel", { id })}
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

  async function handlePrivateCertificate() {
    setZkBusy(true);
    setZkError(null);
    try {
      try {
        const created = await generateZkProof(retirement.retirementId);
        setZkCert(created);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already exists/i.test(msg)) {
          const existing = await fetchZkProof(retirement.retirementId);
          setZkCert(existing);
        } else {
          throw err;
        }
      }
    } catch (err: unknown) {
      setZkError(err instanceof Error ? err.message : t("privateCertificateGenerationFailed"));
    } finally {
      setZkBusy(false);
    }
  }

  function downloadZkJson() {
    if (!zkCert) return;
    const blob = new Blob([JSON.stringify(zkCert, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CarbonLedger-PrivateCert-${retirement.retirementId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const privatePanel = (
    <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: `1px solid ${colors.neutral[200]}` }}>
      <h2 style={{ fontSize: "1.125rem", fontWeight: 600, color: colors.neutral[800], margin: "0 0 0.5rem" }}>
        {t("privateCertificateTitle")}
      </h2>
      <p style={{ fontSize: "0.875rem", color: colors.neutral[500], margin: "0 0 1rem", maxWidth: "40rem" }}>
        {t("privateCertificateDescription")}
      </p>
      <button
        type="button"
        onClick={handlePrivateCertificate}
        disabled={zkBusy}
        style={{
          background: colors.primary[600],
          color: "#fff",
          border: "none",
          padding: "0.65rem 1.25rem",
          fontSize: "0.875rem",
          cursor: zkBusy ? "wait" : "pointer",
          opacity: zkBusy ? 0.7 : 1,
        }}
      >
        {zkBusy ? t("generating") : t("generatePrivateCertificate")}
      </button>
      {zkError && (
        <p style={{ color: colors.neutral[600], fontSize: "0.85rem", marginTop: "0.75rem" }}>{zkError}</p>
      )}
      {zkCert && (
        <div style={{ marginTop: "1.25rem" }}>
          <p style={{ fontSize: "0.8rem", color: colors.neutral[600], margin: "0 0 0.35rem" }}>
            {t("commitmentLabel")} <code style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{zkCert.beneficiaryCommitment}</code>
          </p>
          <p style={{ fontSize: "0.8rem", color: colors.neutral[600], margin: "0 0 0.35rem" }}>
            {t("nullifierLabel")} <code style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{zkCert.nullifier}</code>
          </p>
          <p style={{ fontSize: "0.8rem", color: colors.neutral[600], margin: "0 0 0.75rem" }}>
            {t("walletHashLabel")} <code style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>{zkCert.retiredByHash}</code>
          </p>
          <button
            type="button"
            onClick={downloadZkJson}
            style={{
              background: "transparent",
              color: colors.primary[600],
              border: `1px solid ${colors.primary[600]}`,
              padding: "0.5rem 1rem",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            {t("downloadJson")}
          </button>
        </div>
      )}
    </div>
  );

  if (isNew) {
    return (
      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2.5rem 2rem" }}>
        <RetirementSuccessState retirement={retirement} onDownload={handleDownload} />
        <div style={{ marginTop: "2.5rem" }} id="retirement-certificate-print">
          <RetirementCertificate retirement={retirement} publicUrl={publicUrl} />
        </div>
        {privatePanel}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <a href="/audit" style={{ fontSize: "0.875rem", color: colors.primary[600], textDecoration: "none" }}>
          {t("backToAuditTrail")}
        </a>
        <p style={{ fontSize: "0.8rem", color: colors.neutral[400], margin: "0.5rem 0 0" }}>
          {t("permanentRecordNotice")}{" "}
          {t("permanentUrlLabel")} <code style={{ fontSize: "0.75rem" }}>/api/certificate/{retirement.retirementId}</code>
        </p>
      </div>
      <div id="retirement-certificate-print">
        <RetirementCertificate retirement={retirement} publicUrl={publicUrl} />
      </div>
      {privatePanel}
    </div>
  );
}
