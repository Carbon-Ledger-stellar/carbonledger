import { mutate } from "swr";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Revalidate SWR caches for credit balances, marketplace listings, and retirements
 * after an on-chain transaction succeeds.
 */
export async function invalidateTransactionRelatedCaches(): Promise<void> {
  await mutate(
    (key) =>
      typeof key === "string" &&
      (key.startsWith(`${API_URL}/marketplace/listings`) ||
        key.startsWith(`${API_URL}/retirements`) ||
        key.includes("/credits/")),
    undefined,
    { revalidate: true },
  );
}
