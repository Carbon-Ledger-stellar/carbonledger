import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import ProjectDetailPage from "./page";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls notFound() when the project does not exist", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    await expect(
      ProjectDetailPage({ params: { id: "invalid-project-id" } })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalled();
  });

  it("renders the project when it exists", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "valid-project-id",
        name: "Test Project",
        description: "A project used in tests",
      }),
    });

    const ui = await ProjectDetailPage({ params: { id: "valid-project-id" } });
    render(ui);

    expect(notFound).not.toHaveBeenCalled();
    expect(screen.getByText("Test Project")).toBeInTheDocument();
  });
});
