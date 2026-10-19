import React, { useCallback, useEffect, useRef } from 'react';

export interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
  className?: string;
  /**
   * Stable key used to persist/restore the scroll offset across navigations
   * (e.g. returning from a project detail page). Should change when the
   * underlying list identity changes (e.g. filters applied).
   */
  scrollKey?: string;
}

const SCROLL_STORAGE_PREFIX = 'virtualized-list-scroll:';

function readScrollOffset(key: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.sessionStorage.getItem(SCROLL_STORAGE_PREFIX + key);
    const value = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeScrollOffset(key: string, offset: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SCROLL_STORAGE_PREFIX + key, String(offset));
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

export function VirtualizedList<T>({
  items,
  itemHeight,
  renderItem,
  overscan = 5,
  className,
  scrollKey,
}: VirtualizedListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);

  // Restore the persisted scroll offset when the list mounts (back navigation).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const restored = scrollKey ? readScrollOffset(scrollKey) : 0;
    if (restored > 0) {
      container.scrollTop = restored;
      setScrollTop(restored);
    }
  }, [scrollKey]);

  // Track viewport height for windowing calculations.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => setViewportHeight(container.clientHeight);
    updateHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateHeight);
      observer.observe(container);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const offset = event.currentTarget.scrollTop;
      setScrollTop(offset);
      if (scrollKey) {
        writeScrollOffset(scrollKey, offset);
      }
    },
    [scrollKey],
  );

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);

  const visibleItems: React.ReactNode[] = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const item = items[index];
    visibleItems.push(
      <div
        key={index}
        style={{
          position: 'absolute',
          top: index * itemHeight,
          left: 0,
          right: 0,
          height: itemHeight,
        }}
      >
        {renderItem(item, index)}
      </div>,
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      onScroll={handleScroll}
      style={{ position: 'relative', overflowY: 'auto' }}
    >
      <div style={{ position: 'relative', height: totalHeight }}>
        {visibleItems}
      </div>
    </div>
  );
}

export default VirtualizedList;
