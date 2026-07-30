import { render, screen } from "@testing-library/react";
import BulkPurchaseCart from "../BulkPurchaseCart";

describe("BulkPurchaseCart - Empty Items", () => {
  it("renders empty state when items array is empty", () => {
    render(<BulkPurchaseCart />);

    expect(screen.getByText(/purchase cart/i)).toBeInTheDocument();
    expect(screen.getByText(/add credits from the marketplace/i)).toBeInTheDocument();
  });

  it("shows the empty-cart helper copy", () => {
    render(<BulkPurchaseCart />);
    expect(screen.getByText(/add credits from the marketplace/i)).toBeInTheDocument();
  });
});
