import { Asset } from "@stellar/stellar-sdk";

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon.stellar.org";
const ORDER_BOOK_POLL_MS = 30_000;
const DEFAULT_DEPTH_LIMIT = 50;
const STORAGE_KEY = "carbonledger:sdex:estimate";

export interface SdexAssetConfig {
  code: string;
  issuer: string;
}

export interface OrderBookLevel {
  price: number;
  amount: number;
  cumulative: number;
}

export interface AggregatedOrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  midPrice: number | null;
  totalBidVolume: number;
  totalAskVolume: number;
}

export interface OrderBookQuote {
  requestedQuantity: number;
  filledQuantity: number;
  estimatedPricePerTonne: number;
  estimatedTotalPrice: number;
  averageExecutionPrice: number;
  cutoffPrice: number | null;
  remainingQuantity: number;
  levelsUsed: OrderBookLevel[];
}

export interface StoredOrderBookQuote extends OrderBookQuote {
  createdAt: string;
  sellingAsset: string;
  buyingAsset: string;
}

export interface SdexPair {
  sellingAsset: Asset;
  buyingAsset: Asset;
  label: string;
}

export interface RawOrderBookLevel {
  price: string;
  amount: string;
}

export interface RawOrderBookResponse {
  bids: RawOrderBookLevel[];
  asks: RawOrderBookLevel[];
}

export function getDefaultSdexConfig(): { carbon: SdexAssetConfig; usdc: SdexAssetConfig } {
  const carbonIssuer = process.env.NEXT_PUBLIC_SDEX_CARBON_ISSUER || "";
  const usdcIssuer = process.env.NEXT_PUBLIC_SDEX_USDC_ISSUER || "";

  return {
    carbon: {
      code: process.env.NEXT_PUBLIC_SDEX_CARBON_CODE || "CARBON",
      issuer: carbonIssuer,
    },
    usdc: {
      code: process.env.NEXT_PUBLIC_SDEX_USDC_CODE || "USDC",
      issuer: usdcIssuer,
    },
  };
}

function getAssetCode(asset: Asset): string {
  const typed = asset as unknown as {
    isNative?: () => boolean;
    getCode?: () => string;
    code?: () => string;
    toString?: () => string;
  };

  if (typed.isNative?.()) {
    return "native";
  }

  return typed.getCode?.() ?? typed.code?.() ?? typed.toString?.() ?? "unknown";
}

export function createAsset(code: string, issuer: string): Asset {
  return new Asset(code, issuer);
}

export function createDefaultSdexPair(): SdexPair | null {
  const { carbon, usdc } = getDefaultSdexConfig();
  if (!carbon.issuer || !usdc.issuer) {
    return null;
  }

  return {
    sellingAsset: createAsset(carbon.code, carbon.issuer),
    buyingAsset: createAsset(usdc.code, usdc.issuer),
    label: `${carbon.code}/${usdc.code}`,
  };
}

export function buildLooseOrderBookUrl(sellingCode: string, buyingCode: string): string {
  return `${HORIZON_URL}/order_book?selling=${encodeURIComponent(sellingCode)}&buying=${encodeURIComponent(buyingCode)}`;
}

export function buildOrderBookUrl(sellingAsset: Asset, buyingAsset: Asset): string {
  return buildLooseOrderBookUrl(getAssetCode(sellingAsset), getAssetCode(buyingAsset));
}

function parseLevel(level: RawOrderBookLevel): { price: number; amount: number } | null {
  const price = Number(level.price);
  const amount = Number(level.amount);
  if (!Number.isFinite(price) || !Number.isFinite(amount) || price <= 0 || amount <= 0) {
    return null;
  }
  return { price, amount };
}

function aggregateSide(levels: RawOrderBookLevel[], direction: "asc" | "desc"): OrderBookLevel[] {
  const sorted = levels
    .map(parseLevel)
    .filter((level): level is { price: number; amount: number } => level !== null)
    .sort((a, b) => (direction === "asc" ? a.price - b.price : b.price - a.price));

  let cumulative = 0;
  return sorted.map((level) => {
    cumulative += level.amount;
    return {
      price: level.price,
      amount: level.amount,
      cumulative,
    };
  });
}

export function aggregateOrderBook(orderBook: RawOrderBookResponse): AggregatedOrderBook {
  const asks = aggregateSide(orderBook.asks ?? [], "asc");
  const bids = aggregateSide(orderBook.bids ?? [], "desc");
  const bestAsk = asks[0]?.price ?? null;
  const bestBid = bids[0]?.price ?? null;

  return {
    asks,
    bids,
    bestAsk,
    bestBid,
    spread: bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null,
    midPrice: bestAsk !== null && bestBid !== null ? (bestAsk + bestBid) / 2 : bestAsk ?? bestBid,
    totalAskVolume: asks[asks.length - 1]?.cumulative ?? 0,
    totalBidVolume: bids[bids.length - 1]?.cumulative ?? 0,
  };
}

export function estimateAskFill(levels: OrderBookLevel[], requestedQuantity: number): OrderBookQuote | null {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || levels.length === 0) {
    return null;
  }

  let filledQuantity = 0;
  let totalPrice = 0;
  let cutoffPrice: number | null = null;
  let remaining = requestedQuantity;
  const levelsUsed: OrderBookLevel[] = [];

  for (const level of levels) {
    if (remaining <= 0) {
      break;
    }

    const filledAtLevel = Math.min(level.amount, remaining);
    filledQuantity += filledAtLevel;
    totalPrice += filledAtLevel * level.price;
    cutoffPrice = level.price;
    levelsUsed.push(level);
    remaining -= filledAtLevel;
  }

  if (filledQuantity === 0) {
    return null;
  }

  return {
    requestedQuantity,
    filledQuantity,
    estimatedPricePerTonne: cutoffPrice ?? levels[levels.length - 1].price,
    estimatedTotalPrice: totalPrice,
    averageExecutionPrice: totalPrice / filledQuantity,
    cutoffPrice,
    remainingQuantity: Math.max(0, requestedQuantity - filledQuantity),
    levelsUsed,
  };
}

export async function fetchOrderBook(
  sellingAsset: Asset,
  buyingAsset: Asset,
  limit = DEFAULT_DEPTH_LIMIT,
): Promise<RawOrderBookResponse> {
  const url = `${buildOrderBookUrl(sellingAsset, buyingAsset)}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load order book: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export function formatOrderBookPrice(price: number | null): string {
  if (price === null || !Number.isFinite(price)) {
    return "—";
  }
  return price.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function formatOrderBookVolume(volume: number | null): string {
  if (volume === null || !Number.isFinite(volume)) {
    return "—";
  }
  return volume.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function saveSdexEstimate(quote: StoredOrderBookQuote | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!quote) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(quote));
}

export function loadSdexEstimate(): StoredOrderBookQuote | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredOrderBookQuote) : null;
  } catch {
    return null;
  }
}

export function clearSdexEstimate(): void {
  saveSdexEstimate(null);
}

export { ORDER_BOOK_POLL_MS };
