import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SearchAutocomplete from "../SearchAutocomplete";

const SUGGESTIONS = ["Amazon Reforestation", "Kenya Solar", "Amazon Blue Carbon", "Peru Agroforestry"];

function Wrapper({ suggestions = SUGGESTIONS }: { suggestions?: string[] }) {
  const [value, setValue] = React.useState("");
  return (
    <SearchAutocomplete
      id="search"
      value={value}
      onChange={setValue}
      suggestions={suggestions}
      ariaLabel="Search"
      debounceMs={0}
    />
  );
}

describe("SearchAutocomplete", () => {
  it("shows no suggestions below the minimum character count", () => {
    render(<Wrapper />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("filters suggestions case-insensitively once past the minimum", async () => {
    render(<Wrapper />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "amazon" } });
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Amazon Reforestation")).toBeInTheDocument();
    expect(screen.getByText("Amazon Blue Carbon")).toBeInTheDocument();
    expect(screen.queryByText("Kenya Solar")).not.toBeInTheDocument();
  });

  it("navigates and commits a suggestion with the keyboard", async () => {
    render(<Wrapper />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "amazon" } });
    await screen.findByRole("listbox");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveValue("Amazon Reforestation");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("commits a suggestion on click", async () => {
    render(<Wrapper />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "kenya" } });
    const option = await screen.findByText("Kenya Solar");
    fireEvent.mouseDown(option);
    expect(input).toHaveValue("Kenya Solar");
  });

  it("closes the dropdown on Escape without clearing the input", async () => {
    render(<Wrapper />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "amazon" } });
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("amazon");
  });
});
