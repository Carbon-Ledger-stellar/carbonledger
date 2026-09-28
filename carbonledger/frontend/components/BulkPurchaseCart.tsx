'use client';

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';

/**
 * Optimistic UI for marketplace bulk purchases with conflict resolution.
 *
 * Strategy:
 * 1. On purchase, immediately mark the cart items as `pending` and show a
 *    confirmation banner before the on-chain transaction confirms.
 * 2. Revalidate the listing snapshot (price + inventory) against the values
 *    captured when the item was added to the cart.
 *    - Price changed  -> surface a notification and require user re-confirm.
 *    - Inventory gone -> roll the item back out of the optimistic state.
 * 3. If the transaction fails, roll the whole cart back to its previous
 *    snapshot and offer a retry button.
 */

export type PurchaseStatus = 'idle' | 'pending' | 'confirmed' | 'failed';

export interface CartItem {
  id: string;
  listingId: string;
  name: string;
  /** Price captured when the item was added to the cart. */
  expectedPrice: number;
  /** Latest price observed from the marketplace. */
  currentPrice: number;
  /** Inventory captured when the item was added to the cart. */
  expectedInventory: number;
  /** Latest inventory observed from the marketplace. */
  currentInventory: number;
  quantity: number;
}

export interface Conflict {
  listingId: string;
  type: 'price-changed' | 'inventory-depleted';
  message: string;
}

interface BulkPurchaseCartProps {
  items: CartItem[];
  /** Executes the on-chain purchase. Rejects on failure. */
  onPurchase: (items: CartItem[]) => Promise<void>;
  /** Optional fetcher used to revalidate listing state before confirming. */
  fetcher?: (listingId: string) => Promise<{ price: number; inventory: number }>;
}

const defaultFetcher = async (listingId: string) => {
  const res = await fetch(`/api/marketplace/listings/${listingId}`);
  if (!res.ok) throw new Error(`Failed to load listing ${listingId}`);
  return (await res.json()) as { price: number; inventory: number };
};

export default function BulkPurchaseCart({
  items,
  onPurchase,
  fetcher = defaultFetcher,
}: BulkPurchaseCartProps) {
  const [status, setStatus] = useState<PurchaseStatus>('idle');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [snapshot, setSnapshot] = useState<CartItem[] | null>(null);
  const [optimisticItems, setOptimisticItems] = useState<CartItem[]>(items);

  const total = useMemo(
    () => optimisticItems.reduce((sum, i) => sum + i.currentPrice * i.quantity, 0),
    [optimisticItems],
  );

  const detectConflicts = useCallback(
    async (cart: CartItem[]): Promise<Conflict[]> => {
      const found: Conflict[] = [];
      await Promise.all(
        cart.map(async (item) => {
          const latest = await fetcher(item.listingId);
          if (latest.inventory < item.quantity) {
            found.push({
              listingId: item.listingId,
              type: 'inventory-depleted',
              message: `${item.name} is no longer available in the requested quantity.`,
            });
          } else if (latest.price !== item.expectedPrice) {
            found.push({
              listingId: item.listingId,
              type: 'price-changed',
              message: `${item.name} price changed from ${item.expectedPrice} to ${latest.price}.`,
            });
          }
        }),
      );
      return found;
    },
    [fetcher],
  );

  const handlePurchase = useCallback(async () => {
    const previous = optimisticItems;
    setSnapshot(previous);
    setConflicts([]);
    // Optimistic: show confirmation immediately, before on-chain confirmation.
    setStatus('pending');

    try {
      const detected = await detectConflicts(previous);
      if (detected.length > 0) {
        setConflicts(detected);
        // Roll back items whose inventory was depleted.
        const depleted = new Set(
          detected.filter((c) => c.type === 'inventory-depleted').map((c) => c.listingId),
        );
        if (depleted.size > 0) {
          setOptimisticItems((curr) => curr.filter((i) => !depleted.has(i.listingId)));
        }
        setStatus('idle');
        return;
      }

      await onPurchase(previous);
      setStatus('confirmed');
    } catch {
      // Failed transaction: roll back UI state to the previous snapshot.
      setOptimisticItems(previous);
      setStatus('failed');
    }
  }, [optimisticItems, detectConflicts, onPurchase]);

  const handleRetry = useCallback(() => {
    setStatus('idle');
    void handlePurchase();
  }, [handlePurchase]);

  return (
    <div className="bulk-purchase-cart">
      <ul>
        {optimisticItems.map((item) => (
          <li key={item.id}>
            {item.name} x{item.quantity} — {item.currentPrice}
          </li>
        ))}
      </ul>

      <p>Total: {total}</p>

      {status === 'pending' && (
        <p role="status">Purchase pending confirmation…</p>
      )}
      {status === 'confirmed' && (
        <p role="status">Purchase confirmed.</p>
      )}

      {conflicts.length > 0 && (
        <div role="alert">
          {conflicts.map((c) => (
            <p key={`${c.listingId}-${c.type}`}>{c.message}</p>
          ))}
        </div>
      )}

      {status === 'failed' && (
        <div role="alert">
          <p>Purchase failed. Your cart has been restored.</p>
          <button type="button" onClick={handleRetry}>
            Retry purchase
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={handlePurchase}
        disabled={status === 'pending' || optimisticItems.length === 0}
      >
        Confirm purchase
      </button>
    </div>
  );
}
