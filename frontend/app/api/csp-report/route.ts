/**
 * CSP Violation Report handler — /api/csp-report
 *
 * Issue #626: Collects Content Security Policy violation reports sent by the
 * browser when a resource is blocked by the CSP header.  Reports are logged
 * to stdout (picked up by the Loki/Promtail stack) so Grafana can alert on
 * spikes.
 *
 * The endpoint MUST NOT require authentication — browsers submit reports
 * before the user is known.  Rate limiting is applied at the reverse-proxy
 * layer (nginx).
 *
 * CSP report-uri format:
 * {
 *   "csp-report": {
 *     "document-uri": "https://...",
 *     "violated-directive": "script-src",
 *     "blocked-uri": "https://attacker.example",
 *     ...
 *   }
 * }
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();

    // Normalise both report-uri (csp-report key) and report-to formats.
    const report = body["csp-report"] ?? body;

    const entry = {
      timestamp: new Date().toISOString(),
      documentUri: report["document-uri"] ?? report["document-url"] ?? "unknown",
      blockedUri: report["blocked-uri"] ?? report["blocked-url"] ?? "unknown",
      violatedDirective: report["violated-directive"] ?? report["effective-directive"] ?? "unknown",
      sourceFile: report["source-file"],
      lineNumber: report["line-number"],
    };

    // Structured log — captured by Promtail via stdout.
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "csp_violation",
        ...entry,
        userAgent: req.headers.get("user-agent") ?? "unknown",
        ip: req.headers.get("x-forwarded-for") ?? "unknown",
      })
    );
  } catch {
    // Malformed report body — log and swallow so browser retries don't 500.
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "csp_violation_parse_error",
        timestamp: new Date().toISOString(),
      })
    );
  }

  // 204 No Content — the spec requires a successful 2xx response.
  return new NextResponse(null, { status: 204 });
}

// GET is not supported.
export function GET(): NextResponse {
  return new NextResponse("Method Not Allowed", { status: 405 });
}
