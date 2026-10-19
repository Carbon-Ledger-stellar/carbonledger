import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RetirementCertificate from "@/components/RetirementCertificate";

type CertificatePageProps = {
  params: { id: string };
};

async function getCertificate(id: string) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/certificates/${encodeURIComponent(id)}`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: CertificatePageProps): Promise<Metadata> {
  const certificate = await getCertificate(params.id);
  const url = `/retire/certificate/${params.id}`;

  if (!certificate) {
    return {
      title: "Certificate not found",
      description: "The requested retirement certificate could not be found.",
      alternates: { canonical: url },
    };
  }

  const title = certificate.title ?? "Retirement Certificate";
  const description =
    certificate.description ??
    "View this retirement certificate on our platform.";
  const image = certificate.imageUrl ?? "/og-certificate.png";

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: [{ url: image, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function CertificatePage({ params }: CertificatePageProps) {
  const certificate = await getCertificate(params.id);

  if (!certificate) {
    notFound();
  }

  return <RetirementCertificate certificate={certificate} />;
}
