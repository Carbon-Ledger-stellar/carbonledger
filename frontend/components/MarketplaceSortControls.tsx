"use client";

import { useTranslations } from "next-intl";
import { colors } from "../styles/design-system";
import type { ListingSortField, SortOrder } from "../lib/api";

interface Props {
  sortBy: ListingSortField | "";
  sortOrder: SortOrder;
  onChange: (sortBy: ListingSortField | "", sortOrder: SortOrder) => void;
}

const SORT_FIELDS: { value: ListingSortField | ""; labelKey: string }[] = [
  { value: "", labelKey: "sortDefault" },
  { value: "price", labelKey: "sortPrice" },
  { value: "vintageYear", labelKey: "sortVintage" },
  { value: "methodology", labelKey: "sortMethodology" },
  { value: "verificationDate", labelKey: "sortVerificationDate" },
];

export default function MarketplaceSortControls({ sortBy, sortOrder, onChange }: Props) {
  const t = useTranslations("marketplaceSort");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
      <label htmlFor="marketplace-sort-by" style={{ fontSize: "0.8rem", fontWeight: 600, color: colors.neutral[600] }}>
        {t("sortBy")}
      </label>
      <select
        id="marketplace-sort-by"
        value={sortBy}
        onChange={(e) => onChange(e.target.value as ListingSortField | "", sortOrder)}
        style={{
          border: `1px solid ${colors.neutral[300]}`,
          borderRadius: "0.375rem",
          padding: "0.4rem 0.6rem",
          fontSize: "0.85rem",
          color: colors.neutral[700],
          background: colors.surface,
        }}
      >
        {SORT_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>{t(f.labelKey)}</option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => onChange(sortBy, sortOrder === "asc" ? "desc" : "asc")}
        disabled={!sortBy}
        aria-label={sortOrder === "asc" ? t("sortAscending") : t("sortDescending")}
        title={sortOrder === "asc" ? t("sortAscending") : t("sortDescending")}
        style={{
          border: `1px solid ${colors.neutral[300]}`,
          borderRadius: "0.375rem",
          padding: "0.4rem 0.6rem",
          fontSize: "0.85rem",
          background: colors.surface,
          color: sortBy ? colors.neutral[700] : colors.neutral[300],
          cursor: sortBy ? "pointer" : "default",
        }}
      >
        {sortOrder === "asc" ? "↑" : "↓"}
      </button>
    </div>
  );
}
