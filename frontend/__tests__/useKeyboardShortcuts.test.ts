/**
 * @jest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

function fireKey(key: string, target?: HTMLElement, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  (target ?? document.body).dispatchEvent(event);
}

describe("useKeyboardShortcuts", () => {
  it("calls the handler when the key is pressed", () => {
    const handler = jest.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "/", handler }]));
    fireKey("/");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores the shortcut while focus is inside a text input", () => {
    const handler = jest.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "/", handler }]));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey("/", input);
    expect(handler).not.toHaveBeenCalled();
    input.remove();
  });

  it("still fires in an input when allowInFields is set", () => {
    const handler = jest.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "Escape", handler, allowInFields: true }]));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey("Escape", input);
    expect(handler).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("ignores the shortcut when a modifier key is held", () => {
    const handler = jest.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "/", handler }]));
    fireKey("/", undefined, { ctrlKey: true });
    fireKey("/", undefined, { metaKey: true });
    fireKey("/", undefined, { altKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const handler = jest.fn();
    renderHook(() => useKeyboardShortcuts([{ key: "/", handler }], false));
    fireKey("/");
    expect(handler).not.toHaveBeenCalled();
  });

  it("removes its listener on unmount", () => {
    const handler = jest.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts([{ key: "/", handler }]));
    unmount();
    fireKey("/");
    expect(handler).not.toHaveBeenCalled();
  });
});
