'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks whether a form has unsaved changes and warns the user before
 * navigating away (route change) or closing/reloading the tab (beforeunload).
 *
 * Usage:
 *   const { isDirty, markDirty, markClean } = useUnsavedChanges();
 *   // call markDirty() on every field change, markClean() after a successful save
 */
export function useUnsavedChanges(initialDirty = false) {
  const [isDirty, setIsDirty] = useState(initialDirty);
  const isDirtyRef = useRef(initialDirty);

  const setDirty = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
  }, []);

  const markDirty = useCallback(() => setDirty(true), [setDirty]);
  const markClean = useCallback(() => setDirty(false), [setDirty]);

  // Warn on tab close / reload while the form is dirty.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      event.preventDefault();
      // Legacy browsers require returnValue to be set.
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Warn on in-app route change (client-side navigation) while dirty.
  useEffect(() => {
    if (!isDirty) return;

    const handleClick = (event: MouseEvent) => {
      if (!isDirtyRef.current) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || anchor.target === '_blank') return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to leave this page?'
      );
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [isDirty]);

  return { isDirty, markDirty, markClean };
}
