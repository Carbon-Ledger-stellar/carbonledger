import { render, screen } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState Component', () => {
  it('renders with default props', () => {
    render(<EmptyState />);
    expect(screen.getByText(/no data available/i)).toBeInTheDocument();
  });

  it('displays custom title and description', () => {
    render(
      <EmptyState 
        title="No Listings Found"
        description="Try adjusting your filters"
      />
    );
    
    expect(screen.getByText('No Listings Found')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
  });
});
