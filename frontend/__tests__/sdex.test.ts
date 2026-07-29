import {
  aggregateOrderBook,
  estimateAskFill,
  formatOrderBookPrice,
  buildLooseOrderBookUrl,
} from "../lib/sdex";

describe("sdex order book helpers", () => {
  it("aggregates asks ascending and bids descending with cumulative depth", () => {
    const result = aggregateOrderBook({
      asks: [
        { price: "14.25", amount: "8" },
        { price: "13.50", amount: "4" },
        { price: "14.75", amount: "3" },
      ],
      bids: [
        { price: "12.00", amount: "2" },
        { price: "12.50", amount: "5" },
        { price: "11.75", amount: "1" },
      ],
    });

    expect(result.asks.map((level) => level.price)).toEqual([13.5, 14.25, 14.75]);
    expect(result.asks.map((level) => level.cumulative)).toEqual([4, 12, 15]);
    expect(result.bids.map((level) => level.price)).toEqual([12.5, 12, 11.75]);
    expect(result.bids.map((level) => level.cumulative)).toEqual([5, 7, 8]);
    expect(result.bestAsk).toBe(13.5);
    expect(result.bestBid).toBe(12.5);
    expect(result.spread).toBe(1);
    expect(result.midPrice).toBe(13);
    expect(result.totalAskVolume).toBe(15);
    expect(result.totalBidVolume).toBe(8);
  });

  it("estimates a fill across multiple ask levels", () => {
    const quote = estimateAskFill(
      [
        { price: 10, amount: 3, cumulative: 3 },
        { price: 12, amount: 4, cumulative: 7 },
        { price: 15, amount: 10, cumulative: 17 },
      ],
      6,
    );

    expect(quote).not.toBeNull();
    expect(quote?.filledQuantity).toBe(6);
    expect(quote?.cutoffPrice).toBe(12);
    expect(quote?.estimatedPricePerTonne).toBe(12);
    expect(quote?.estimatedTotalPrice).toBeCloseTo(66);
    expect(quote?.averageExecutionPrice).toBeCloseTo(11);
    expect(quote?.remainingQuantity).toBe(0);
    expect(quote?.levelsUsed.length).toBe(2);
  });

  it("returns null when no quantity is requested", () => {
    expect(estimateAskFill([], 10)).toBeNull();
    expect(estimateAskFill([{ price: 10, amount: 1, cumulative: 1 }], 0)).toBeNull();
  });

  it("formats invalid prices as placeholders", () => {
    expect(formatOrderBookPrice(null)).toBe("—");
  });

  it("builds a Horizon order book URL from raw asset codes when needed", () => {
    expect(buildLooseOrderBookUrl("CARBON", "USDC")).toContain("selling=CARBON");
    expect(buildLooseOrderBookUrl("CARBON", "USDC")).toContain("buying=USDC");
  });
});
