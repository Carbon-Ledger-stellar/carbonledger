'use client';

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import BulkPurchaseCart, {
  type BulkPurchaseCartItem,
  type PurchaseResult,
} from '../../components/BulkPurchaseCart';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Listing = {
  id: string;
  projectName: string;
  pricePerTonne: number;
  availableTonnes: number;
};

type PendingPurchase = {
  id: string;
  items: BulkPurchaseCartItem[];
  total: number;
  status: 'pending' | 'confirmed' | 'failed';
  error?: string;
};

export default function BuyPage() {
  const { data: listings, mutate } = useSWR<Listing[]>('/api/marketplace/listings', fetcher);
  const [pending, setPending] = useState<PendingPurchase[]>([]);
  const [notification, setNotification] = useState<string | null>(null);

  const listingById = useMemo(() => {
    const map = new Map<string, Listing>();
    (listings ?? []).forEach((listing) => map.set(listing.id, listing));
    return map;
  }, [listings]);

  const handlePurchase = useCallback(
    async (items: BulkPurchaseCartItem[]): Promise<PurchaseResult> => {
      const total = items.reduce((sum, item) => sum + item.pricePerTonne * item.tonnes, 0);
      const purchaseId = `purchase-${Date.now()}`;

      // Optimistic update: show confirmation immediately, before the transaction confirms.
      setPending((prev) => [
        ...prev,
        { id: purchaseId, items, total, status: 'pending' },
      ]);

      // Optimistically decrement inventory in the cached listings.
      await mutate(
        (current) =>
          current?.map((listing) => {
            const item = items.find((entry) => entry.listingId === listing.id);
            if (!item) return listing;
            return { ...listing, availableTonnes: listing.availableTonnes - item.tonnes };
          }),
        { revalidate: false },
      );

      try {
        const response = await fetch('/api/marketplace/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          // Conflict detection: price changed or inventory depleted.
          if (response.status === 409) {
            const conflict = payload?.conflict as
              | { type: 'price_changed' | 'inventory_depleted'; listingId: string; message?: string }
              | undefined;

            if (conflict?.type === 'price_changed') {
              setNotification(
                conflict.message ??
                  'A listing price changed while you were checking out. Review the updated price before retrying.',
              );
            } else if (conflict?.type === 'inventory_depleted') {
              setNotification(
                conflict.message ??
                  'A listing sold out before your purchase completed. Your cart has been rolled back.',
              );
            }
          }

          throw new Error(payload?.message ?? 'Purchase failed');
        }

        setPending((prev) =>
          prev.map((entry) =>
            entry.id === purchaseId ? { ...entry, status: 'confirmed' } : entry,
          ),
        );

        // Reconcile optimistic state with the server's authoritative listings.
        await mutate();

        return { success: true, purchaseId };
      } catch (error) {
        // Rollback UI state to the previous state on failure.
        await mutate();
        setPending((prev) =>
          prev.map((entry) =>
            entry.id === purchaseId
              ? {
                  ...entry,
                  status: 'failed',
                  error: error instanceof Error ? error.message : 'Purchase failed',
                }
              : entry,
          ),
        );

        return {
          success: false,
          purchaseId,
          error: error instanceof Error ? error.message : 'Purchase failed',
        };
      }
    },
    [mutate],
  );

  const handleRetry = useCallback(
    (purchaseId: string) => {
      const failed = pending.find((entry) => entry.id === purchaseId);
      if (!failed) return;
      setPending((prev) => prev.filter((entry) => entry.id !== purchaseId));
      void handlePurchase(failed.items);
    },
    [pending, handlePurchase],
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Buy carbon credits</h1>

      {notification ? (
        <div
          role="alert"
          className="mt-4 flex items-start justify-between rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <span>{notification}</span>
          <button
            type="button"
            className="ml-4 font-medium underline"
            onClick={() => setNotification(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <BulkPurchaseCart
        listings={listings ?? []}
        listingById={listingById}
        onPurchase={handlePurchase}
      />

      {pending.length > 0 ? (
        <section className="mt-8" aria-live="polite">
          <h2 className="text-lg font-medium">Purchases</h2>
          <ul className="mt-2 space-y-2">
            {pending.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <span>
                  {entry.items.length} listing(s) · {entry.total.toFixed(2)} tCO₂e
                </span>
                <span className="flex items-center gap-3">
                  <span
                    className={
                      entry.status === 'confirmed'
                        ? 'text-green-700'
                        : entry.status === 'failed'
                          ? 'text-red-700'
                          : 'text-slate-500'
                    }
                  >
                    {entry.status === 'confirmed'
                      ? 'Confirmed'
                      : entry.status === 'failed'
                        ? `Failed: ${entry.error}`
                        : 'Pending confirmation…'}
                  </span>
                  {entry.status === 'failed' ? (
                    <button
                      type="button"
                      className="rounded border px-2 py-1 font-medium"
                      onClick={() => handleRetry(entry.id)}
                    >
                      Retry
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
