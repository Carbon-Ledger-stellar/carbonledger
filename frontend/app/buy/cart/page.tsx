"use client";

import { useTranslations } from "next-intl";
import { colors } from "../../../styles/design-system";
import BulkPurchaseCart from "../../../components/BulkPurchaseCart";

export default function CartPage() {
  const t = useTranslations("cartPage");
  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <a href="/marketplace" style={{ fontSize: "0.875rem", color: colors.primary[600], textDecoration: "none" }}>
        {t("backToMarketplace")}
      </a>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "1rem 0 0.25rem" }}>
        {t("title")}
      </h1>
      <p style={{ color: colors.neutral[500], fontSize: "0.875rem", margin: "0 0 2rem" }}>
        {t("subtitle")}
      </p>
      <BulkPurchaseCart />
    </div>
  );
}
