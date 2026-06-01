import { render, screen } from '@testing-library/react';
import { Marketplace } from '../Marketplace';

describe('Marketplace - Empty State', () => {
  it('renders empty state when listings array is empty', () => {
    render(<Marketplace listings={[]} />);
    
    expect(screen.getByText(/no listings available/i)).toBeInTheDocument();
    expect(screen.queryByTestId('listing-card')).not.toBeInTheDocument();
  });

  it('does not crash when listings is undefined', () => {
    render(<Marketplace listings={undefined as any} />);
    expect(screen.getByText(/no listings available/i)).toBeInTheDocument();
  });
});
