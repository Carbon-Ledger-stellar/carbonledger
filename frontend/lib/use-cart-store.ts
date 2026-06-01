"use client";

import { useState, useEffect, useCallback } from "react";
import { MarketListing } from "./api";

export interface CartItem {
  listing: MarketListing;
  amount: number;
}

const STORAGE_KEY = "carbonledger:cart";

function loadCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function useCartStore() {
  const [items, setItems] = useState<CartItem[]>([]);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setItems(loadCart());
  }, []);

  const addItem = useCallback((listing: MarketListing, amount: number) => {
    setItems(prev => {
      const idx = prev.findIndex(i => i.listing.listingId === listing.listingId);
      const next = idx >= 0
        ? prev.map((item, i) => i === idx ? { ...item, amount } : item)
        : [...prev, { listing, amount }];
      saveCart(next);
      return next;
    });
  }, []);

  const removeItem = useCallback((listingId: string) => {
    setItems(prev => {
      const next = prev.filter(i => i.listing.listingId !== listingId);
      saveCart(next);
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const totalTonnes = items.reduce((sum, i) => sum + i.amount, 0);

  const subtotalStroops = items.reduce(
    (sum, i) => sum + BigInt(i.listing.pricePerCredit) * BigInt(i.amount),
    0n,
  );

  // Protocol fee: 1% of subtotal
  const protocolFeeStroops = subtotalStroops / 100n;
  const totalStroops = subtotalStroops + protocolFeeStroops;

  return {
    items,
    addItem,
    removeItem,
    clearCart,
    totalTonnes,
    subtotalStroops,
    protocolFeeStroops,
    totalStroops,
  };
}
