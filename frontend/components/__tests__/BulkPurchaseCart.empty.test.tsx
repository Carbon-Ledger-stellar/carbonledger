import { render, screen } from '@testing-library/react';
import { BulkPurchaseCart } from '../BulkPurchaseCart';

describe('BulkPurchaseCart - Empty Items', () => {
  it('renders empty state when items array is empty', () => {
    render(<BulkPurchaseCart items={[]} onCheckout={jest.fn()} />);
    
    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
    
    const checkoutButton = screen.queryByRole('button', { name: /checkout|purchase/i });
    if (checkoutButton) {
      expect(checkoutButton).toBeDisabled();
    }
  });

  it('shows estimated total of $0 when cart is empty', () => {
    render(<BulkPurchaseCart items={[]} onCheckout={jest.fn()} />);
    expect(screen.getByText(/\$0/i)).toBeInTheDocument();
  });
});
