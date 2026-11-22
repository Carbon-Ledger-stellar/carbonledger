import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import LoadingSkeleton from "../LoadingSkeleton";

describe("LoadingSkeleton", () => {
  it("marks itself busy for assistive tech", () => {
    const { container } = render(<LoadingSkeleton variant="CreditCard" />);
    expect(container.firstChild).toHaveAttribute("aria-busy", "true");
  });

  // The wrapper's first child is a <style> tag (the shimmer keyframes), so
  // rows are everything after it — use `.children` (element nodes only) to
  // sidestep that rather than assuming a childNode index.
  function rows(container: HTMLElement): HTMLElement[] {
    const wrapper = container.firstChild as HTMLElement;
    return Array.from(wrapper.children).filter((el) => el.tagName !== "STYLE") as HTMLElement[];
  }

  it("renders one row per count for the Table variant", () => {
    const { container } = render(<LoadingSkeleton variant="Table" count={5} columns={4} />);
    expect(rows(container).length).toBe(5);
  });

  it("renders the requested number of shimmer cells per table row", () => {
    const { container } = render(<LoadingSkeleton variant="Table" count={1} columns={6} />);
    expect(rows(container)[0].children.length).toBe(6);
  });

  it("defaults to 4 columns when none is specified", () => {
    const { container } = render(<LoadingSkeleton variant="Table" count={1} />);
    expect(rows(container)[0].children.length).toBe(4);
  });

  describe("Dashboard variant (#1510)", () => {
    it("renders without throwing", () => {
      expect(() => render(<LoadingSkeleton variant="Dashboard" />)).not.toThrow();
    });

    it("renders the aria-busy wrapper", () => {
      const { container } = render(<LoadingSkeleton variant="Dashboard" />);
      expect(container.firstChild).toHaveAttribute("aria-busy", "true");
    });

    it("renders 4 KPI card skeletons matching the final layout", () => {
      const { container } = render(<LoadingSkeleton variant="Dashboard" />);
      // The KPI grid is the first element inside the DashboardSkeleton div
      const kpiGrid = container.querySelector(".dashboard-skeleton-kpi");
      expect(kpiGrid).not.toBeNull();
      // 4 card divs inside the KPI grid
      expect(kpiGrid!.children.length).toBe(4);
    });

    it("renders 2 chart placeholder blocks", () => {
      const { container } = render(<LoadingSkeleton variant="Dashboard" />);
      const chartsGrid = container.querySelector(".dashboard-skeleton-charts");
      expect(chartsGrid).not.toBeNull();
      expect(chartsGrid!.children.length).toBe(2);
    });
  });
});
