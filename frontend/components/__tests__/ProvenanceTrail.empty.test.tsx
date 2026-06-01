import { render, screen } from '@testing-library/react';
import { ProvenanceTrail } from '../ProvenanceTrail';

describe('ProvenanceTrail - Empty Events', () => {
  it('renders empty state when events array is empty', () => {
    render(<ProvenanceTrail events={[]} />);
    
    expect(screen.getByText(/no provenance events found/i)).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-item')).not.toBeInTheDocument();
  });

  it('handles null events gracefully', () => {
    render(<ProvenanceTrail events={null as any} />);
    expect(screen.getByText(/no provenance events found/i)).toBeInTheDocument();
  });
});
