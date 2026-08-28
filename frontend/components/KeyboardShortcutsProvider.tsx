"use client";

import { useCallback, useState } from "react";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import KeyboardShortcutsHelp from "./KeyboardShortcutsHelp";

/**
 * Mounts the app-wide keyboard shortcuts ("/" to search, "?" for help) and
 * renders the help dialog. Lives once at the root (see AppProviders) so the
 * shortcuts work from any page without each page wiring its own listener.
 */
export default function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [helpOpen, setHelpOpen] = useState(false);

  const focusSearch = useCallback((e: KeyboardEvent) => {
    const target = document.querySelector<HTMLElement>('[data-shortcut-target="search"]');
    if (!target) return;
    e.preventDefault();
    target.focus();
  }, []);

  useKeyboardShortcuts(
    [
      { key: "/", handler: focusSearch },
      { key: "?", handler: () => setHelpOpen(true) },
      { key: "Escape", handler: () => setHelpOpen(false), allowInFields: true },
    ],
    !helpOpen // the help dialog owns Escape/Tab itself while it's open
  );

  return (
    <>
      {children}
      {helpOpen && <KeyboardShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </>
  );
}
