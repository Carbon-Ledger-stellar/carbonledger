"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { colors, borderRadius, shadows, spacing, typography } from "../styles/design-system";
import { formatTonnes } from "../lib/carbon-utils";
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

export default function OrderBookChart({ title = "Live SDEX order book" }: OrderBookChartProps) {
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
      aria-labelledby={chartId}
      style={{
        background: `linear-gradient(180deg, ${colors.surface} 0%, ${colors.surfaceAlt} 100%)`,
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: borderRadius.xl,
        boxShadow: shadows.sm,
        overflow: "hidden",
      }}
    >
      <style>{`
        .sdex-widget-grid {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: ${spacing[5]};
        }

        .sdex-chart-shell {
          position: relative;
          border-radius: ${borderRadius.lg};
          background: ${colors.neutral[50]};
          border: 1px solid ${colors.neutral[200]};
          overflow: hidden;
        }

        .sdex-chart {
          width: 100%;
          height: 360px;
          display: block;
        }

        .sdex-compact-only {
          display: block;
        }

        @media (max-width: 767px) {
          .sdex-widget-grid {
            grid-template-columns: 1fr;
          }

          .sdex-chart {
            height: 280px;
          }

          .sdex-compact-only {
            display: none;
          }
        }
      `}</style>

      <div style={{ padding: `${spacing[5]} ${spacing[5]} ${spacing[4]}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: spacing[4], alignItems: "flex-start", marginBottom: spacing[4] }}>
          <div>
            <p style={{ margin: 0, fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, color: colors.primary[600], textTransform: "uppercase", letterSpacing: "0.08em" }}>
              SDEX price discovery
            </p>
            <h2 id={chartId} style={{ margin: "0.25rem 0 0", fontSize: typography.fontSize.xl, fontWeight: typography.fontWeight.bold, color: colors.neutral[900] }}>
              {title}
            </h2>
            <p style={{ margin: "0.35rem 0 0", fontSize: typography.fontSize.sm, color: colors.neutral[500] }}>
              Live depth for {pairLabel} with polling paused when the tab is hidden.
            </p>
          </div>

          <div className="sdex-compact-only" style={{ textAlign: "right" }}>
            <div style={{ fontSize: typography.fontSize.xs, color: colors.neutral[500] }}>Status</div>
            <div style={{ fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.neutral[900] }}>
              {loading ? "Loading…" : error ? "Unavailable" : "Live"}
            </div>
          </div>
        </div>

        <div className="sdex-widget-grid">
          <div>
            {error ? (
              <div style={{ padding: spacing[5], borderRadius: borderRadius.lg, background: colors.neutral[50], border: `1px solid ${colors.neutral[200]}` }}>
                <p style={{ margin: 0, color: colors.suspended.text, fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium }}>{error}</p>
                <p style={{ margin: `${spacing[2]} 0 0`, color: colors.neutral[500], fontSize: typography.fontSize.xs }}>
                  Check the Horizon endpoint and SDEX issuer configuration.
                </p>
              </div>
            ) : (
              <div className="sdex-chart-shell">
                <svg
                  viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
                  preserveAspectRatio="none"
                  className="sdex-chart"
                  onMouseMove={handleMove}
                  onMouseLeave={() => setHovered(null)}
                  role="img"
                  aria-label="Order book step chart"
                >
                  <defs>
                    <linearGradient id="sdex-ask-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity="0.06" />
                    </linearGradient>
                  </defs>

                  <line x1={MARGIN.left} y1={VIEWBOX_HEIGHT - MARGIN.bottom} x2={VIEWBOX_WIDTH - MARGIN.right} y2={VIEWBOX_HEIGHT - MARGIN.bottom} stroke={colors.neutral[300]} strokeWidth={1} />
                  <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={VIEWBOX_HEIGHT - MARGIN.bottom} stroke={colors.neutral[300]} strokeWidth={1} />

                  {chart?.fillRect && (
                    <rect
                      x={chart.fillRect.x}
                      y={MARGIN.top}
                      width={Math.max(2, chart.fillRect.width)}
                      height={VIEWBOX_HEIGHT - MARGIN.top - MARGIN.bottom}
                      fill="url(#sdex-ask-fill)"
                    />
                  )}

                  {chart?.bidPath && <path d={chart.bidPath} fill="none" stroke="#16a34a" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
                  {chart?.askPath && <path d={chart.askPath} fill="none" stroke="#dc2626" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}

                  {hovered && chart && <circle cx={hovered.x} cy={hovered.y} r={6} fill={hovered.side === "ask" ? "#dc2626" : "#16a34a"} stroke="#fff" strokeWidth={2} />}

                  {chart && orderBook && [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                    const price = chart.minPrice + ratio * (chart.maxPrice - chart.minPrice);
                    const x = chart.xScale(price);
                    return (
                      <g key={ratio}>
                        <line x1={x} y1={VIEWBOX_HEIGHT - MARGIN.bottom} x2={x} y2={VIEWBOX_HEIGHT - MARGIN.bottom + 6} stroke={colors.neutral[300]} />
                        <text x={x} y={VIEWBOX_HEIGHT - 14} textAnchor="middle" fill={colors.neutral[500]} fontSize={11}>
                          {formatOrderBookPrice(price)}
                        </text>
                      </g>
                    );
                  })}

                  {chart && orderBook && [0, 0.33, 0.66, 1].map((ratio) => {
                    const volume = ratio * chart.maxVolume;
                    const y = chart.yScale(volume);
                    return (
                      <g key={ratio}>
                        <line x1={MARGIN.left - 6} y1={y} x2={MARGIN.left} y2={y} stroke={colors.neutral[300]} />
                        <text x={MARGIN.left - 10} y={y + 4} textAnchor="end" fill={colors.neutral[500]} fontSize={11}>
                          {formatOrderBookVolume(volume)}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {hovered && (
                  <div
                    style={{
                      position: "absolute",
                      top: spacing[3],
                      right: spacing[3],
                      minWidth: "240px",
                      padding: spacing[3],
                      background: "rgba(255,255,255,0.96)",
                      border: `1px solid ${colors.neutral[200]}`,
                      borderRadius: borderRadius.lg,
                      boxShadow: shadows.md,
                    }}
                  >
                    <div style={{ fontSize: typography.fontSize.xs, color: colors.neutral[500], marginBottom: spacing[1] }}>
                      {hovered.side === "ask" ? "Ask depth" : "Bid depth"}
                    </div>
                    <div style={{ fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.bold, color: colors.neutral[900] }}>
                      {formatOrderBookPrice(hovered.level.price)} USDC / tCO₂e
                    </div>
                    <div style={{ fontSize: typography.fontSize.sm, color: colors.neutral[600], marginTop: spacing[1] }}>
                      {hovered.side === "ask"
                        ? `Cumulative volume available at or below this price: ${formatTonnes(hovered.level.cumulative)}`
                        : `Cumulative volume available at or above this price: ${formatTonnes(hovered.level.cumulative)}`}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <aside style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
            <div style={{ padding: spacing[4], background: colors.neutral[50], borderRadius: borderRadius.lg, border: `1px solid ${colors.neutral[200]}` }}>
              <label htmlFor="sdex-quantity" style={{ display: "block", fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.neutral[700], marginBottom: spacing[2] }}>
                Estimated fill
              </label>
              <input
                id="sdex-quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                aria-label="Estimated fill quantity"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: `${spacing[3]} ${spacing[3]}`,
                  borderRadius: borderRadius.md,
                  border: `1px solid ${colors.neutral[300]}`,
                  fontSize: typography.fontSize.base,
                  fontWeight: typography.fontWeight.semibold,
                  color: colors.neutral[900],
                  marginBottom: spacing[3],
                }}
              />

              {quote ? (
                <>
                  <Metric label="Estimated fill price" value={`${formatOrderBookPrice(quote.estimatedPricePerTonne)} USDC / tCO₂e`} />
                  <Metric label="Average execution price" value={`${formatOrderBookPrice(quote.averageExecutionPrice)} USDC / tCO₂e`} />
                  <Metric label="Estimated total" value={`${formatOrderBookPrice(quote.estimatedTotalPrice)} USDC`} />
                  <Metric label="Filled volume" value={formatTonnes(quote.filledQuantity)} />
                  {quote.remainingQuantity > 0 && <Metric label="Unfilled remainder" value={formatTonnes(quote.remainingQuantity)} />}
                </>
              ) : (
                <p style={{ margin: 0, color: colors.neutral[500], fontSize: typography.fontSize.sm }}>
                  Enter a quantity to preview the price band that would be consumed by the current asks.
                </p>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[4] }}>
                <button
                  type="button"
                  disabled={!quote}
                  onClick={applyEstimateToCart}
                  style={{
                    background: quote ? colors.primary[600] : colors.neutral[300],
                    color: "#fff",
                    border: "none",
                    borderRadius: borderRadius.md,
                    padding: `${spacing[2]} ${spacing[3]}`,
                    fontWeight: typography.fontWeight.semibold,
                    cursor: quote ? "pointer" : "not-allowed",
                  }}
                >
                  Use estimate in cart
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearSdexEstimate();
                    setSavedEstimate(null);
                  }}
                  style={{
                    background: colors.neutral[100],
                    color: colors.neutral[700],
                    border: `1px solid ${colors.neutral[200]}`,
                    borderRadius: borderRadius.md,
                    padding: `${spacing[2]} ${spacing[3]}`,
                    fontWeight: typography.fontWeight.semibold,
                    cursor: "pointer",
                  }}
                >
                  Clear estimate
                </button>
              </div>
            </div>

            <div style={{ padding: spacing[4], background: colors.neutral[50], borderRadius: borderRadius.lg, border: `1px solid ${colors.neutral[200]}` }}>
              <Metric label="Best bid" value={formatOrderBookPrice(orderBook?.bestBid ?? null)} />
              <Metric label="Best ask" value={formatOrderBookPrice(orderBook?.bestAsk ?? null)} />
              <Metric label="Spread" value={orderBook?.spread !== null && orderBook?.spread !== undefined ? `${formatOrderBookPrice(orderBook.spread)} USDC` : "—"} />
              <Metric label="Ask depth" value={formatTonnes(orderBook?.totalAskVolume ?? 0)} />
              <Metric label="Bid depth" value={formatTonnes(orderBook?.totalBidVolume ?? 0)} />
              {savedEstimate && (
                <p style={{ margin: `${spacing[3]} 0 0`, color: colors.primary[700], fontSize: typography.fontSize.xs }}>
                  Saved quote for {formatTonnes(savedEstimate.requestedQuantity)} on {savedEstimate.sellingAsset}/{savedEstimate.buyingAsset}.
                </p>
              )}
              {loading && (
                <p style={{ margin: `${spacing[3]} 0 0`, color: colors.neutral[500], fontSize: typography.fontSize.xs }}>
                  Refreshing every 30 seconds while visible.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
