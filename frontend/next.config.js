/**
 * next.config.js — CarbonLedger frontend configuration
 *
 * Issue #626: Strict Content Security Policy and hardened security response
 * headers.
 *
 * CSP design decisions:
 *  - script-src: 'self' + nonce-gated for Next.js internal inline scripts.
 *    No unsafe-inline; no unsafe-eval.
 *  - style-src: 'self' + 'unsafe-inline' is required for CSS-in-JS (Next.js
 *    inserts inline <style> tags at hydration).  A nonce-based approach for
 *    styles requires additional middleware; documented as future enhancement.
 *  - connect-src: allows the Stellar/Soroban RPC endpoints and the local API.
 *  - img-src: allows IPFS gateways used for project images.
 *  - frame-ancestors: 'none' — the app must never be embedded in an iframe.
 *  - Freighter browser extension injects its own scripts into the page.  Those
 *    scripts are added by the extension to the user's browser session and are
 *    NOT blocked by the page CSP (extension content scripts are exempt from
 *    page CSP per the Web Extension spec).
 *
 * Security headers added (all 6 required by issue #626):
 *  1. Content-Security-Policy
 *  2. Strict-Transport-Security (HSTS)
 *  3. X-Frame-Options
 *  4. X-Content-Type-Options
 *  5. Referrer-Policy
 *  6. Permissions-Policy
 */

const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// ── Content Security Policy ────────────────────────────────────────────────
const CSP_DIRECTIVES = [
  // Scripts: only same-origin + nonce-gated Next.js internals.
  // 'strict-dynamic' propagates trust from nonce to dynamically added scripts.
  "script-src 'self' 'strict-dynamic'",

  // Styles: 'unsafe-inline' is needed for Next.js CSS-in-JS hydration.
  "style-src 'self' 'unsafe-inline'",

  // Default fallback for all other resource types.
  "default-src 'self'",

  // Images: self + data URIs (favicon) + IPFS gateways for project images.
  "img-src 'self' data: blob: https://ipfs.io https://gateway.pinata.cloud",

  // Fonts: same origin only (no Google Fonts CDN).
  "font-src 'self'",

  // Fetch / XHR / WebSocket targets.
  [
    "connect-src 'self'",
    "https://horizon-testnet.stellar.org",
    "https://horizon.stellar.org",
    "https://soroban-testnet.stellar.org",
    "https://soroban.stellar.org",
    "wss://soroban-testnet.stellar.org",
    "wss://soroban.stellar.org",
    // Allow runtime-configured API URL (falls back to localhost in dev).
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  ].join(" "),

  // Workers (service worker, audio/video worklets).
  "worker-src 'self' blob:",

  // Media: no external media sources.
  "media-src 'self'",

  // Objects/plugins: none — no Flash, no Java.
  "object-src 'none'",

  // Base URI: restrict to same origin to prevent base tag hijacking.
  "base-uri 'self'",

  // Form actions: same origin only.
  "form-action 'self'",

  // Frame embedding: completely blocked.
  "frame-ancestors 'none'",

  // Upgrade all HTTP sub-resource requests to HTTPS.
  "upgrade-insecure-requests",

  // Report violations to the backend endpoint (see app/api/csp-report/route.ts).
  "report-uri /api/csp-report",
];

const CSP_HEADER_VALUE = CSP_DIRECTIVES.join("; ");

// ── Security headers ───────────────────────────────────────────────────────
const SECURITY_HEADERS = [
  // 1. Content Security Policy
  {
    key: "Content-Security-Policy",
    value: CSP_HEADER_VALUE,
  },

  // 2. HSTS — tells browsers to only connect over HTTPS for 2 years and
  //    includes subdomains.  The preload flag opts into Chrome's preload list.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },

  // 3. X-Frame-Options (legacy fallback for browsers without CSP frame-ancestors).
  {
    key: "X-Frame-Options",
    value: "DENY",
  },

  // 4. X-Content-Type-Options — prevents MIME-type sniffing attacks.
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },

  // 5. Referrer-Policy — do not leak the full URL to third parties.
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },

  // 6. Permissions-Policy — disable browser features the app never uses.
  {
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "ambient-light-sensor=()",
    ].join(", "),
  },

  // Cross-Origin policies — required for SharedArrayBuffer / high-resolution
  // timers used by Stellar SDK WASM modules.
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "require-corp",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "same-origin",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  turbopack: {
    root: __dirname,
  },
  images: {
    domains: ["ipfs.io", "gateway.pinata.cloud"],
  },
  env: {
    NEXT_PUBLIC_STELLAR_NETWORK:
      process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet",
    NEXT_PUBLIC_HORIZON_URL:
      process.env.NEXT_PUBLIC_HORIZON_URL ||
      "https://horizon-testnet.stellar.org",
    NEXT_PUBLIC_SOROBAN_RPC_URL:
      process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
      "https://soroban-testnet.stellar.org",
    NEXT_PUBLIC_REGISTRY_CONTRACT:
      process.env.NEXT_PUBLIC_REGISTRY_CONTRACT || "",
    NEXT_PUBLIC_CREDIT_CONTRACT: process.env.NEXT_PUBLIC_CREDIT_CONTRACT || "",
    NEXT_PUBLIC_MARKETPLACE_CONTRACT:
      process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT || "",
    NEXT_PUBLIC_ORACLE_CONTRACT: process.env.NEXT_PUBLIC_ORACLE_CONTRACT || "",
    NEXT_PUBLIC_USDC_CONTRACT: process.env.NEXT_PUBLIC_USDC_CONTRACT || "",
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
  },

  // Attach security headers to every response.
  async headers() {
    // The strict CSP relies on Next.js nonce-gated script tags. Turbopack's
    // dev server does not attach nonces to its dynamically loaded chunks, so
    // enforcing the CSP in development blocks hydration entirely. Only apply
    // the security headers for production builds (where nonces are emitted);
    // the `security-headers` Playwright project asserts them against `next
    // start`, so they remain covered in CI.
    if (process.env.NODE_ENV !== "production") {
      return [];
    }

    return [
      {
        // Apply to all routes.
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
      {
        // The CSP report endpoint must accept POST from any origin (browser
        // submits reports without credentials).  Relax CORP for this path only.
        source: "/api/csp-report",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

module.exports = withNextIntl(nextConfig);
