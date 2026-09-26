/**
 * Public Audit Explorer — /audit/explorer
 *
 * No-wallet-required interface for looking up any carbon credit's complete
 * provenance chain: project registration → verifier approval → oracle monitoring
 * → minting → marketplace listings → transfers → retirement with certificate.
 *
 * Server-side rendered for SEO / accessibility. Client-side search updates
 * without full page reload.
 */

import { Suspense } from "react";
import AuditExplorerClient from "./AuditExplorerClient";

export const metadata = {
  title: "Carbon Credit Audit Explorer | CarbonLedger",
  description:
    "Public audit trail for any carbon credit serial number. No wallet required. " +
    "Look up project registration, verifier approval, oracle monitoring, minting, " +
    "transfers, and final retirement — all verified on the Stellar blockchain.",
  openGraph: {
    title: "Carbon Credit Audit Explorer | CarbonLedger",
    description:
      "Verify any carbon credit's complete on-chain provenance. Publicly accessible to regulators, journalists, and the public.",
    type: "website",
  },
};

export default function AuditExplorerPage() {
  return (
    <main role="main" aria-label="Carbon Credit Audit Explorer">
      <Suspense
        fallback={
          <div
            style={{
              minHeight: "60vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#9ca3af",
            }}
          >
            Loading audit explorer…
          </div>
        }
      >
        <AuditExplorerClient />
      </Suspense>
    </main>
  );
}
