import React, { useCallback, useEffect, useMemo, useState } from 'react';

export interface BulkPurchaseItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  soldOut?: boolean;
  delisted?: boolean;
}

interface PersistedCart {
  version: number;
  items: BulkPurchaseItem[];
}

const STORAGE_KEY = 'bulkPurchaseCart:v1';
const STORAGE_VERSION = 1;

function loadPersistedCart(): BulkPurchaseItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedCart;
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items.filter(
      (item): item is BulkPurchaseItem =>
        !!item && typeof item.id === 'string' && typeof item.name === 'string'
    );
  } catch {
    return [];
  }
}

function persistCart(items: BulkPurchaseItem[]): void {
  try {
    const payload: PersistedCart = { version: STORAGE_VERSION, items };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be unavailable (private mode, quota); fail silently.
  }
}

function clearPersistedCart(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors on clear.
  }
}

function isStale(item: BulkPurchaseItem): boolean {
  return item.soldOut === true || item.delisted === true;
}

interface BulkPurchaseCartProps {
  availableItems?: BulkPurchaseItem[];
}

export default function BulkPurchaseCart({ availableItems }: BulkPurchaseCartProps) {
  const [items, setItems] = useState<BulkPurchaseItem[]>(() => loadPersistedCart());
  const [staleIds, setStaleIds] = useState<string[]>([]);

  // Flag stale listings (sold out / delisted) on reload.
  useEffect(() => {
    if (!availableItems) return;
    const lookup = new Map(availableItems.map((item) => [item.id, item]));
    const stale = items
      .filter((item) => {
        const current = lookup.get(item.id);
        if (!current) return true;
        return isStale(current);
      })
      .map((item) => item.id);
    setStaleIds(stale);
  }, [availableItems, items]);

  // Persist cart contents whenever they change.
  useEffect(() => {
    persistCart(items);
  }, [items]);

  const addItem = useCallback((item: BulkPurchaseItem) => {
    setItems((prev) => {
      const existing = prev.find((entry) => entry.id === item.id);
      if (existing) {
        return prev.map((entry) =>
          entry.id === item.id ? { ...entry, quantity: entry.quantity + item.quantity } : entry
        );
      }
      return [...prev, item];
    });
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    setItems((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, quantity: Math.max(1, quantity) } : entry))
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setStaleIds([]);
    clearPersistedCart();
  }, []);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items]
  );

  return (
    <div className="bulk-purchase-cart">
      <h2>Bulk Purchase Cart</h2>
      {items.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <ul className="bulk-purchase-cart__items">
          {items.map((item) => {
            const stale = staleIds.includes(item.id);
            return (
              <li
                key={item.id}
                className={`bulk-purchase-cart__item${stale ? ' bulk-purchase-cart__item--stale' : ''}`}
              >
                <span className="bulk-purchase-cart__name">{item.name}</span>
                {stale && (
                  <span className="bulk-purchase-cart__stale-flag" role="status">
                    Unavailable
                  </span>
                )}
                <input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(event) => updateQuantity(item.id, Number(event.target.value))}
                  aria-label={`Quantity for ${item.name}`}
                />
                <span className="bulk-purchase-cart__price">
                  ${(item.price * item.quantity).toFixed(2)}
                </span>
                <button type="button" onClick={() => removeItem(item.id)}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="bulk-purchase-cart__footer">
        <strong>Total: ${total.toFixed(2)}</strong>
        <button type="button" onClick={clearCart} disabled={items.length === 0}>
          Clear cart
        </button>
      </div>
    </div>
  );
}
