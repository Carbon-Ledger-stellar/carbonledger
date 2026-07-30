import type { Metadata } from "next";
import RetirementCertificateClient from "../../../components/RetirementCertificateClient";
import type { RetirementRecord } from "../../../lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL;
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

async function fetchRetirement(id: string): Promise<RetirementRecord | null> {
  if (!API_URL) return null;
  try {
    const res = await fetch(`${API_URL}/retirements/${id}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const retirement = await fetchRetirement(id);
  const canonicalPath = `/retire/${id}`;

  if (!retirement) {
    return {
      title: "Retirement certificate — Carbon Ledger",
      alternates: { canonical: canonicalPath },
    };
  }

  const projectName = retirement.projectName ?? retirement.project?.name ?? "a verified carbon project";
  const title = `${retirement.amount} tCO₂e retired by ${retirement.beneficiary} — Carbon Ledger`;
  const description = `${retirement.beneficiary} permanently retired ${retirement.amount} tonnes of CO₂e from ${projectName} (vintage ${retirement.vintageYear}). Verified on-chain on Stellar — certificate ${retirement.retirementId}.`;

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      url: canonicalPath,
      siteName: "Carbon Ledger",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function RetirementCertificatePage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const retirement = await fetchRetirement(id);

  return (
    <>
      {retirement && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Certificate",
              name: `Carbon Retirement Certificate ${retirement.retirementId}`,
              url: `${SITE_URL}/retire/${id}`,
              recipient: { "@type": "Organization", name: retirement.beneficiary },
              about: { "@type": "Thing", name: retirement.projectName ?? retirement.project?.name },
              dateIssued: retirement.retiredAt,
              identifier: retirement.retirementId,
            }),
          }}
        />
      )}
      <RetirementCertificateClient id={id} />
    </>
  );
}
