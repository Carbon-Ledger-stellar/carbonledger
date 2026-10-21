import React, { useCallback, useEffect, useMemo, useState } from 'react';

export interface BulkCartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  soldOut?: boolean;
  delisted?: boolean;
}

const STORAGE_KEY = 'bulkPurchaseCart:v1';

interface PersistedCart {
  version: 1;
  items: BulkCartItem[];
}

function readPersistedCart(): BulkCartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedCart;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter(
      (item): item is BulkCartItem =>
        !!item && typeof item.id === 'string' && typeof item.name === 'string'
    );
  } catch {
    return [];
  }
}

function writePersistedCart(items: BulkCartItem[]): void {
  try {
    const payload: PersistedCart = { version: 1, items };
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

function isStale(item: BulkCartItem): boolean {
  return item.soldOut === true || item.delisted === true;
}

interface BulkPurchaseCartProps {
  availableListings?: Record<string, { soldOut?: boolean; delisted?: boolean }>;
}

export const BulkPurchaseCart: React.FC<BulkPurchaseCartProps> = ({ availableListings }) => {
  const [items, setItems] = useState<BulkCartItem[]>(() => readPersistedCart());

  useEffect(() => {
    writePersistedCart(items);
  }, [items]);

  const flaggedItems = useMemo(() => {
    if (!availableListings) return items;
    return items.map((item) => {
      const listing = availableListings[item.id];
      if (!listing) return item;
      return {
        ...item,
        soldOut: listing.soldOut ?? item.soldOut,
        delisted: listing.delisted ?? item.delisted,
      };
    });
  }, [items, availableListings]);

  const addItem = useCallback((item: BulkCartItem) => {
    setItems((prev) => {
      const existing = prev.find((entry) => entry.id === item.id);
      if (existing) {
        return prev.map((entry) =>
          entry.id === item.id
            ? { ...entry, quantity: entry.quantity + item.quantity }
            : entry
        );
      }
      return [...prev, item];
    });
  }, []);

  const updateQuantity = useCallback((id: string, quantity: number) => {
    setItems((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, quantity } : entry))
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    clearPersistedCart();
  }, []);

  const total = flaggedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="bulk-purchase-cart">
      <h2>Bulk Purchase Cart</h2>
      {flaggedItems.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <ul>
          {flaggedItems.map((item) => (
            <li key={item.id} className={isStale(item) ? 'cart-item cart-item--stale' : 'cart-item'}>
              <span>{item.name}</span>
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => updateQuantity(item.id, Number(e.target.value))}
              />
              <span>${(item.price * item.quantity).toFixed(2)}</span>
              {isStale(item) && (
                <span className="cart-item__warning">
                  {item.delisted ? 'No longer available' : 'Sold out'}
                </span>
              )}
              <button type="button" onClick={() => removeItem(item.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="bulk-purchase-cart__total">Total: ${total.toFixed(2)}</div>
      <button type="button" onClick={clearCart} disabled={flaggedItems.length === 0}>
        Clear cart
      </button>
    </div>
  );
};

export default BulkPurchaseCart;
