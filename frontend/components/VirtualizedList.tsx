"use client";

import { useRef, useState, useMemo, useCallback } from "react";

interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  /** Visible viewport height in px. */
  height: number;
  /** Extra rows rendered above/below the viewport to smooth fast scrolling. */
  overscan?: number;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Below this count, all rows render without windowing — virtualization only pays off past a threshold. */
  virtualizeThreshold?: number;
}

/**
 * Lightweight windowed list — renders only the rows intersecting the visible
 * scroll range (+ overscan) so large listing sets (100+) don't cause layout
 * jank from mounting hundreds of DOM rows at once. No external dependency;
 * fixed-height rows are required for the offset math to stay O(1).
 */
export default function VirtualizedList<T>({
  items,
  itemHeight,
  height,
  overscan = 4,
  getKey,
  renderItem,
  virtualizeThreshold = 20,
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const onScroll = useCallback(() => {
    if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
  }, []);

  const totalHeight = items.length * itemHeight;

  const { startIndex, endIndex } = useMemo(() => {
    if (items.length <= virtualizeThreshold) {
      return { startIndex: 0, endIndex: items.length - 1 };
    }
    const visibleCount = Math.ceil(height / itemHeight);
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(items.length - 1, start + visibleCount + overscan * 2);
    return { startIndex: start, endIndex: end };
  }, [items.length, height, itemHeight, overscan, scrollTop, virtualizeThreshold]);

  const isVirtualized = items.length > virtualizeThreshold;
  const visibleItems = items.slice(startIndex, endIndex + 1);

  if (!isVirtualized) {
    return (
      <div>
        {items.map((item, i) => (
          <div key={getKey(item, i)} style={{ height: itemHeight }}>
            {renderItem(item, i)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{ height, overflowY: "auto", position: "relative" }}
      data-testid="virtualized-list-viewport"
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {visibleItems.map((item, i) => {
          const index = startIndex + i;
          return (
            <div
              key={getKey(item, index)}
              style={{
                position: "absolute",
                top: index * itemHeight,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
