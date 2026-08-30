import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import KeyboardShortcutsProvider from "../KeyboardShortcutsProvider";

describe("KeyboardShortcutsProvider", () => {
  it("opens the help dialog on '?'", () => {
    render(<KeyboardShortcutsProvider>{null}</KeyboardShortcutsProvider>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "?" });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("closes the help dialog on Escape and returns focus to the trigger", () => {
    render(
      <KeyboardShortcutsProvider>
        <button>Somewhere on the page</button>
      </KeyboardShortcutsProvider>
    );
    const trigger = screen.getByText("Somewhere on the page");
    trigger.focus();

    fireEvent.keyDown(document, { key: "?" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("focuses the element marked as the search target on '/'", () => {
    render(
      <KeyboardShortcutsProvider>
        <input data-shortcut-target="search" aria-label="Search" />
      </KeyboardShortcutsProvider>
    );
    fireEvent.keyDown(document, { key: "/" });
    expect(screen.getByLabelText("Search")).toHaveFocus();
  });

  it("does not hijack '/' while already typing in a field", () => {
    render(
      <KeyboardShortcutsProvider>
        <input data-shortcut-target="search" aria-label="Search" />
        <input aria-label="Other field" />
      </KeyboardShortcutsProvider>
    );
    const other = screen.getByLabelText("Other field");
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(other).toHaveFocus();
  });
});
