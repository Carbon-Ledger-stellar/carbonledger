import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EsgDateRangeFilter } from "./EsgDateRangeFilter";

describe("EsgDateRangeFilter", () => {
  it("renders start and end date inputs", () => {
    render(<EsgDateRangeFilter onChange={vi.fn()} />);
    expect(screen.getByLabelText(/start date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/end date/i)).toBeInTheDocument();
  });

  it("shows an inline error when end date is before start date", () => {
    render(<EsgDateRangeFilter onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2024-06-01" },
    });
    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: "2024-05-01" },
    });
    expect(
      screen.getByText(/end date must be on or after the start date/i)
    ).toBeInTheDocument();
  });

  it("does not emit onChange for an invalid range", () => {
    const onChange = vi.fn();
    render(<EsgDateRangeFilter onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2024-06-01" },
    });
    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: "2024-05-01" },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits onChange for a valid range", () => {
    const onChange = vi.fn();
    render(<EsgDateRangeFilter onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2024-01-01" },
    });
    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: "2024-03-01" },
    });
    expect(onChange).toHaveBeenCalledWith({
      start: "2024-01-01",
      end: "2024-03-01",
    });
  });

  it("applies the last 30 days preset", () => {
    const onChange = vi.fn();
    render(<EsgDateRangeFilter onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /last 30 days/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const range = onChange.mock.calls[0][0];
    const start = new Date(range.start);
    const end = new Date(range.end);
    const diffDays = Math.round(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    );
    expect(diffDays).toBe(30);
  });

  it("applies the last 90 days preset", () => {
    const onChange = vi.fn();
    render(<EsgDateRangeFilter onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /last 90 days/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const range = onChange.mock.calls[0][0];
    const start = new Date(range.start);
    const end = new Date(range.end);
    const diffDays = Math.round(
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    );
    expect(diffDays).toBe(90);
  });

  it("applies the year-to-date preset", () => {
    const onChange = vi.fn();
    render(<EsgDateRangeFilter onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /year to date|ytd/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const range = onChange.mock.calls[0][0];
    const start = new Date(range.start);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
  });
});
