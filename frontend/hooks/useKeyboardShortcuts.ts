"use client";

import { useEffect } from "react";

export interface KeyboardShortcut {
  /** The key as reported by KeyboardEvent.key, e.g. "/", "?", "Escape". */
  key: string;
  handler: (e: KeyboardEvent) => void;
  /**
   * When true, this shortcut still fires while focus is inside an input,
   * textarea, select, or contenteditable element (e.g. "Escape" to close a
   * dialog). Defaults to false — most single-key shortcuts must not steal
   * keystrokes from a field the user is typing into.
   */
  allowInFields?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Registers global single-key keyboard shortcuts for the lifetime of the
 * component. Shortcuts are disabled while the user is typing in a form
 * field (see `allowInFields`), and ignore keystrokes with a modifier held
 * (Cmd/Ctrl/Alt) so they never shadow browser or OS shortcuts.
 *
 * The listener is attached at the document level, so shortcuts work
 * regardless of which part of the page (including inside a `role="dialog"`
 * modal, or while a `<table>` row has focus) currently has focus — as long
 * as that focus isn't inside an editable field.
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      for (const shortcut of shortcuts) {
        if (e.key !== shortcut.key) continue;
        if (!shortcut.allowInFields && isEditableTarget(e.target)) continue;
        shortcut.handler(e);
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shortcuts` is expected to be a stable array from the caller
  }, [enabled]);
}
