import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPathname = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

import PauseBanner from "@/components/PauseBanner";

describe("PauseBanner", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockPathname.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockPauseStatus(paused: boolean) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ paused }),
    }) as unknown as typeof fetch;
  }

  it.each(["/buy", "/retire", "/projects/new"]) (
    "renders the pause banner on %s when the contract is paused",
    async (path) => {
      mockPathname.mockReturnValue(path);
      mockPauseStatus(true);

      render(<PauseBanner />);

      expect(
        await screen.findByRole("status")
      ).toBeInTheDocument();
      expect(screen.getByText(/paused/i)).toBeInTheDocument();
    }
  );

  it("hides the banner when the contract is not paused", async () => {
    mockPathname.mockReturnValue("/buy");
    mockPauseStatus(false);

    render(<PauseBanner />);

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
