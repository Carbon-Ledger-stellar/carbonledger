"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import dynamic from "next/dynamic";
import { colors, borderRadius, shadows, spacing, typography } from "../styles/design-system";
import { formatTonnes } from "../lib/carbon-utils";
import LoadingSkeleton from "./LoadingSkeleton";
import {
  ORDER_BOOK_POLL_MS,
  AggregatedOrderBook,
  OrderBookLevel,
  StoredOrderBookQuote,
  aggregateOrderBook,
  buildLooseOrderBookUrl,
  clearSdexEstimate,
  createDefaultSdexPair,
  estimateAskFill,
  fetchOrderBook,
  formatOrderBookPrice,
  formatOrderBookVolume,
  loadSdexEstimate,
  saveSdexEstimate,
} from "../lib/sdex";

interface OrderBookChartProps {
  title?: string;
}

type HoverPoint = {
  side: "ask" | "bid";
  level: OrderBookLevel;
  x: number;
  y: number;
};

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 360;
const MARGIN = { top: 24, right: 28, bottom: 42, left: 54 };

function buildStepPath(levels: OrderBookLevel[], xScale: (value: number) => number, yScale: (value: number) => number) {
  if (!levels.length) return "";

  let path = `M ${xScale(levels[0].price)} ${yScale(0)}`;
  path += ` L ${xScale(levels[0].price)} ${yScale(levels[0].cumulative)}`;

  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1];
    const current = levels[index];
    path += ` L ${xScale(current.price)} ${yScale(previous.cumulative)}`;
    path += ` L ${xScale(current.price)} ${yScale(current.cumulative)}`;
  }

  return path;
}

function nearestLevel(levels: OrderBookLevel[], price: number): OrderBookLevel | null {
  if (!levels.length) return null;

  return levels.reduce<OrderBookLevel | null>((closest, level) => {
    if (!closest) return level;
    return Math.abs(level.price - price) < Math.abs(closest.price - price) ? level : closest;
  }, null);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: spacing[3], padding: `${spacing[1]} 0` }}>
      <span style={{ color: colors.neutral[500], fontSize: typography.fontSize.xs }}>{label}</span>
      <span style={{ color: colors.neutral[900], fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function OrderBookChartSkeleton() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading order book chart"
      style={{
        background: colors.neutral[0],
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: borderRadius.lg,
        boxShadow: shadows.sm,
        padding: spacing[5],
        display: "flex",
        flexDirection: "column",
        gap: spacing[3],
      }}
    >
      <LoadingSkeleton width="40%" height="20px" />
      <LoadingSkeleton width="100%" height="360px" />
    </section>
  );
}

function OrderBookChartImpl({ title = "Live SDEX order book" }: OrderBookChartProps) {
  const pair = useMemo(() => createDefaultSdexPair(), []);
  const pairLabel = pair?.label ?? "CARBON/USDC";
  const chartId = useId();

  const [orderBook, setOrderBook] = useState<AggregatedOrderBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(() => loadSdexEstimate()?.requestedQuantity?.toString() ?? "100");
  const [hovered, setHovered] = useState<HoverPoint | null>(null);
  const [savedEstimate, setSavedEstimate] = useState<StoredOrderBookQuote | null>(() => loadSdexEstimate());
  const [visible, setVisible] = useState(() => (typeof document === "undefined" ? true : document.visibilityState === "visible"));

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const onVisibilityChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();

    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      if (!visible) return;

      setLoading(true);
      try {
        const raw = pair
          ? await fetchOrderBook(pair.sellingAsset, pair.buyingAsset)
          : await fetch(buildLooseOrderBookUrl("CARBON", "USDC")).then((response) => {
              if (!response.ok) {
                throw new Error(`Failed to load order book: ${response.status} ${response.statusText}`);
              }
              return response.json();
            });

        if (cancelled) return;
        setOrderBook(aggregateOrderBook(raw));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setOrderBook(null);
        setError(err instanceof Error ? err.message : "Unable to load order book");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (visible) {
      load();
      interval = setInterval(load, ORDER_BOOK_POLL_MS);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [pair, visible]);

  const quote = useMemo(() => {
    if (!orderBook) return null;
    return estimateAskFill(orderBook.asks, Number(quantity));
  }, [orderBook, quantity]);

  useEffect(() => {
    if (!quote) {
      clearSdexEstimate();
      setSavedEstimate(null);
      return;
    }

    const estimate: StoredOrderBookQuote = {
      ...quote,
      createdAt: new Date().toISOString(),
      sellingAsset: pairLabel.split("/")[0],
      buyingAsset: pairLabel.split("/")[1] ?? "USDC",
    };

    saveSdexEstimate(estimate);
    setSavedEstimate(estimate);
  }, [pairLabel, quote]);

  const chart = useMemo(() => {
    if (!orderBook) return null;

    const allPrices = [...orderBook.asks, ...orderBook.bids].map((item) => item.price);
    if (allPrices.length === 0) return null;

    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const span = Math.max(maxPrice - minPrice, maxPrice * 0.02 || 1);
    const xMin = MARGIN.left;
    const xMax = VIEWBOX_WIDTH - MARGIN.right;
    const yMin = MARGIN.top;
    const yMax = VIEWBOX_HEIGHT - MARGIN.bottom;
    const maxVolume = Math.max(orderBook.totalAskVolume, orderBook.totalBidVolume, 1);

    const xScale = (price: number) => xMin + ((price - (minPrice - span * 0.08)) / (span * 1.16)) * (xMax - xMin);
    const yScale = (value: number) => yMax - (value / maxVolume) * (yMax - yMin);
    const bestAsk = orderBook.bestAsk;
    const fillCutoff = quote?.cutoffPrice ?? null;
    const fillRect = bestAsk !== null && fillCutoff !== null && fillCutoff >= bestAsk
      ? { x: xScale(bestAsk), width: Math.max(0, xScale(fillCutoff) - xScale(bestAsk)) }
      : null;

    return {
      xScale,
      yScale,
      askPath: buildStepPath(orderBook.asks, xScale, yScale),
      bidPath: buildStepPath(orderBook.bids, xScale, yScale),
      fillRect,
      minPrice: minPrice - span * 0.08,
      maxPrice: maxPrice + span * 0.08,
      maxVolume,
    };
  }, [orderBook, quote?.cutoffPrice]);

  const handleMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!chart || !orderBook) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
    const price = chart.minPrice + ((x - MARGIN.left) / (VIEWBOX_WIDTH - MARGIN.left - MARGIN.right)) * (chart.maxPrice - chart.minPrice);
    const ask = nearestLevel(orderBook.asks, price);
    const bid = nearestLevel(orderBook.bids, price);

    const candidates: HoverPoint[] = [];
    if (ask) candidates.push({ side: "ask", level: ask, x: chart.xScale(ask.price), y: chart.yScale(ask.cumulative) });
    if (bid) candidates.push({ side: "bid", level: bid, x: chart.xScale(bid.price), y: chart.yScale(bid.cumulative) });

    const next = candidates.sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
    setHovered(next ?? null);
  };

  const applyEstimateToCart = () => {
    if (!quote) return;

    const estimate: StoredOrderBookQuote = {
      ...quote,
      createdAt: new Date().toISOString(),
      sellingAsset: pairLabel.split("/")[0],
      buyingAsset: pairLabel.split("/")[1] ?? "USDC",
    };

    saveSdexEstimate(estimate);
    setSavedEstimate(estimate);
    window.location.href = "/buy/cart";
  };

  return (
    <section
      aria-labelledby={`${chartId}-title`}
      style={{
        background: colors.neutral[0],
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: borderRadius.lg,
        boxShadow: shadows.sm,
        padding: spacing[5],
        display: "flex",
        flexDirection: "column",
        gap: spacing[4],
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: spacing[3] }}>
        <div>
          <h2 id={`${chartId}-title`} style={{ margin: 0, fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.semibold, color: colors.neutral[900] }}>
            {title}
          </h2>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>
            {pairLabel} · updates every {Math.round(ORDER_BOOK_POLL_MS / 1000)}s
          </p>
        </div>
        {loading && <span style={{ fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>Refreshing…</span>}
      </header>

      {error && (
        <div role="alert" style={{ color: colors.semantic?.error ?? colors.neutral[700], fontSize: typography.fontSize.sm }}>
          {error}
        </div>
      )}

      {!chart ? (
        <LoadingSkeleton width="100%" height="360px" />
      ) : (
        <svg
          role="img"
          aria-label={`${pairLabel} order book depth chart`}
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHovered(null)}
        >
          <line x1={MARGIN.left} y1={VIEWBOX_HEIGHT - MARGIN.bottom} x2={VIEWBOX_WIDTH - MARGIN.right} y2={VIEWBOX_HEIGHT - MARGIN.bottom} stroke={colors.neutral[200]} />
          <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={VIEWBOX_HEIGHT - MARGIN.bottom} stroke={colors.neutral[200]} />

          {chart.fillRect && (
            <rect x={chart.fillRect.x} y={MARGIN.top} width={chart.fillRect.width} height={VIEWBOX_HEIGHT - MARGIN.top - MARGIN.bottom} fill={colors.primary?.[100] ?? colors.neutral[100]} opacity={0.6} />
          )}

          <path d={chart.bidPath} fill="none" stroke={colors.semantic?.success ?? colors.neutral[700]} strokeWidth={2} />
          <path d={chart.askPath} fill="none" stroke={colors.semantic?.error ?? colors.neutral[700]} strokeWidth={2} />

          {hovered && (
            <g>
              <circle cx={hovered.x} cy={hovered.y} r={4} fill={hovered.side === "ask" ? (colors.semantic?.error ?? colors.neutral[700]) : (colors.semantic?.success ?? colors.neutral[700])} />
              <text x={hovered.x + 8} y={hovered.y - 8} fontSize={typography.fontSize.xs} fill={colors.neutral[900]}>
                {formatOrderBookPrice(hovered.level.price)} · {formatOrderBookVolume(hovered.level.cumulative)}
              </text>
            </g>
          )}
        </svg>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing[4] }}>
        <div>
          <Metric label="Best ask" value={orderBook?.bestAsk != null ? formatOrderBookPrice(orderBook.bestAsk) : "—"} />
          <Metric label="Best bid" value={orderBook?.bestBid != null ? formatOrderBookPrice(orderBook.bestBid) : "—"} />
          <Metric label="Ask volume" value={formatTonnes(orderBook?.totalAskVolume ?? 0)} />
          <Metric label="Bid volume" value={formatTonnes(orderBook?.totalBidVolume ?? 0)} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: typography.fontSize.xs, color: colors.neutral[500], marginBottom: spacing[1] }} htmlFor={`${chartId}-qty`}>
            Estimate quantity
          </label>
          <input
            id={`${chartId}-qty`}
            type="number"
            min={0}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            style={{ width: "100%", padding: spacing[2], borderRadius: borderRadius.md, border: `1px solid ${colors.neutral[200]}`, fontSize: typography.fontSize.sm }}
          />
          <Metric label="Avg fill price" value={quote ? formatOrderBookPrice(quote.averagePrice) : "—"} />
          <Metric label="Total cost" value={quote ? formatOrderBookPrice(quote.totalCost) : "—"} />
          <button
            type="button"
            onClick={applyEstimateToCart}
            disabled={!quote}
            style={{
              marginTop: spacing[2],
              width: "100%",
              padding: `${spacing[2]} ${spacing[3]}`,
              borderRadius: borderRadius.md,
              border: "none",
              background: colors.primary?.[600] ?? colors.neutral[900],
              color: colors.neutral[0],
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.semibold,
              cursor: quote ? "pointer" : "not-allowed",
              opacity: quote ? 1 : 0.6,
            }}
          >
            Apply to cart
          </button>
          {savedEstimate && (
            <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>
              Saved estimate: {formatOrderBookPrice(savedEstimate.averagePrice)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const OrderBookChart = dynamic(() => Promise.resolve(OrderBookChartImpl), {
  ssr: false,
  loading: () => <OrderBookChartSkeleton />,
});

export default OrderBookChart;
