import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * GET /api/certificate/[id]
 *
 * Permanent public URL for a retirement certificate.
 * - Returns the retirement record as JSON (for programmatic access).
 * - Clients can use the `?format=redirect` query param to be redirected
 *   to the human-readable certificate page at /retire/[id].
 *
 * The client-side PDF download lives in RetirementCertificate.tsx (jsPDF + html2canvas).
 * This endpoint satisfies the "permanent public URL resolves to the same certificate"
 * acceptance criterion by being a stable, cacheable route.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: "Missing retirement ID" }, { status: 400 });
  }

  // ?format=redirect → send browser to the certificate page
  if (request.nextUrl.searchParams.get("format") === "redirect") {
    return NextResponse.redirect(new URL(`/retire/${id}`, request.url));
  }

  if (!API_URL) {
    return NextResponse.json({ error: "API not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${API_URL}/retirements/${id}`, {
      next: { revalidate: 3600 }, // cache for 1 hour — certificate data is immutable
    });

    if (!res.ok) {
      const status = res.status === 404 ? 404 : 502;
      return NextResponse.json({ error: "Certificate not found" }, { status });
    }

    const data = await res.json();

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch certificate" }, { status: 502 });
  }
}
