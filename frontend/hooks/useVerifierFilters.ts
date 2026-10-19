"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type VerifierStatusFilter = "pending" | "approved" | "rejected";

export const VERIFIER_STATUS_FILTERS: VerifierStatusFilter[] = [
  "pending",
  "approved",
  "rejected",
];

export interface VerifierFilters {
  status: VerifierStatusFilter | null;
  methodology: string | null;
}

const STATUS_PARAM = "status";
const METHODOLOGY_PARAM = "methodology";

function parseStatus(value: string | null): VerifierStatusFilter | null {
  if (!value) return null;
  return VERIFIER_STATUS_FILTERS.includes(value as VerifierStatusFilter)
    ? (value as VerifierStatusFilter)
    : null;
}

export function useVerifierFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo<VerifierFilters>(
    () => ({
      status: parseStatus(searchParams.get(STATUS_PARAM)),
      methodology: searchParams.get(METHODOLOGY_PARAM) || null,
    }),
    [searchParams]
  );

  const setFilters = useCallback(
    (next: Partial<VerifierFilters>) => {
      const params = new URLSearchParams(searchParams.toString());
      const merged: VerifierFilters = { ...filters, ...next };

      if (merged.status) {
        params.set(STATUS_PARAM, merged.status);
      } else {
        params.delete(STATUS_PARAM);
      }

      if (merged.methodology) {
        params.set(METHODOLOGY_PARAM, merged.methodology);
      } else {
        params.delete(METHODOLOGY_PARAM);
      }

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [filters, pathname, router, searchParams]
  );

  const setStatus = useCallback(
    (status: VerifierStatusFilter | null) => setFilters({ status }),
    [setFilters]
  );

  const setMethodology = useCallback(
    (methodology: string | null) => setFilters({ methodology }),
    [setFilters]
  );

  const clearFilters = useCallback(
    () => setFilters({ status: null, methodology: null }),
    [setFilters]
  );

  const hasActiveFilters = filters.status !== null || filters.methodology !== null;

  return {
    filters,
    setFilters,
    setStatus,
    setMethodology,
    clearFilters,
    hasActiveFilters,
  };
}
