import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MarketplaceSortControls from '../MarketplaceSortControls';

jest.mock('next-intl');

describe('MarketplaceSortControls', () => {
  it('calls onChange with the selected sort field, preserving current order', () => {
    const onChange = jest.fn();
    render(<MarketplaceSortControls sortBy="" sortOrder="asc" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'price' } });

    expect(onChange).toHaveBeenCalledWith('price', 'asc');
  });

  it('toggles sort order when the direction button is clicked', () => {
    const onChange = jest.fn();
    render(<MarketplaceSortControls sortBy="price" sortOrder="asc" onChange={onChange} />);

    // Button's accessible name/title reflects the *current* order (asc → "Ascending");
    // clicking it flips to the opposite order.
    fireEvent.click(screen.getByRole('button', { name: 'Ascending' }));

    expect(onChange).toHaveBeenCalledWith('price', 'desc');
  });

  it('disables the direction toggle when no sort field is selected', () => {
    render(<MarketplaceSortControls sortBy="" sortOrder="asc" onChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Ascending' })).toBeDisabled();
  });
});
