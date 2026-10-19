import { useCallback, useEffect, useRef } from 'react';

const STORAGE_PREFIX = 'scroll-restoration:';

interface ScrollRestorationOptions {
  /**
   * Key identifying the list whose scroll offset should be restored.
   * Include any active filter state in this key so that each filter
   * combination keeps its own offset.
   */
  key: string;
  /**
   * Whether the list is currently rendered and able to accept a scroll
   * offset. Restoration is deferred until this becomes true.
   */
  enabled?: boolean;
}

interface ScrollRestorationResult<T extends HTMLElement> {
  ref: React.RefObject<T>;
  /** Persist the current offset immediately (e.g. before navigating away). */
  saveScrollPosition: () => void;
}

function readOffset(key: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeOffset(key: string, offset: number): void {
  if (typeof window === 'undefined') return;
  try {
    if (offset > 0) {
      window.sessionStorage.setItem(STORAGE_PREFIX + key, String(offset));
    } else {
      window.sessionStorage.removeItem(STORAGE_PREFIX + key);
    }
  } catch {
    // sessionStorage may be unavailable (private mode, quota); ignore.
  }
}

/**
 * Persists and restores the scroll offset of a scrollable element across
 * navigations (e.g. returning from a detail page to a VirtualizedList).
 *
 * The offset is stored in sessionStorage keyed by `key`, so it survives
 * component unmount/remount and works per filter combination.
 */
export function useScrollRestoration<T extends HTMLElement = HTMLDivElement>({
  key,
  enabled = true,
}: ScrollRestorationOptions): ScrollRestorationResult<T> {
  const ref = useRef<T>(null);
  const restoredKeyRef = useRef<string | null>(null);

  const saveScrollPosition = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    writeOffset(key, node.scrollTop);
  }, [key]);

  // Restore once the element is mounted and enabled for the current key.
  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node) return;
    if (restoredKeyRef.current === key) return;

    const offset = readOffset(key);
    if (offset > 0) {
      node.scrollTop = offset;
    }
    restoredKeyRef.current = key;
  }, [key, enabled]);

  // Persist the offset on scroll and when the element unmounts.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const handleScroll = () => {
      writeOffset(key, node.scrollTop);
    };

    node.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', handleScroll);
      writeOffset(key, node.scrollTop);
    };
  }, [key]);

  return { ref, saveScrollPosition };
}

export default useScrollRestoration;
