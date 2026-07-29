import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ComparisonTray, { MAX_COMPARISON_ITEMS } from '../ComparisonTray';
import type { MarketListing } from '../../lib/api';

jest.mock('next-intl');

// Avoid pulling in @stellar/stellar-sdk (crashes under jsdom — missing TextEncoder), same
// workaround used by __tests__/carbon-utils.test.ts.
jest.mock('../../lib/stellar', () => ({
  formatStroops: (stroops: bigint | number | string) => {
    const n = BigInt(stroops);
    const whole = n / 10_000_000n;
    const frac = (n % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  },
  parseStroops: (usdc: string) => {
    const [whole, frac = ''] = usdc.split('.');
    const fracPadded = frac.padEnd(7, '0').slice(0, 7);
    return BigInt(whole) * 10_000_000n + BigInt(fracPadded);
  },
}));

function listing(overrides: Partial<MarketListing>): MarketListing {
  return {
    id: overrides.listingId ?? 'row-1',
    listingId: 'L1',
    projectId: 'P1',
    projectName: 'Amazon Reforestation',
    batchId: 'B1',
    seller: 'GSELLER',
    amountAvailable: 100,
    pricePerCredit: '100000000', // 10.0000000 in stroops
    vintageYear: 2022,
    methodology: 'VCS',
    country: 'Brazil',
    status: 'Active',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ComparisonTray', () => {
  it('renders nothing when no listings are selected', () => {
    const { container } = render(<ComparisonTray selected={[]} onRemove={jest.fn()} onClear={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected count out of the max', () => {
    const selected = [listing({ listingId: 'L1' }), listing({ listingId: 'L2', projectName: 'Kenya Solar' })];
    render(<ComparisonTray selected={selected} onRemove={jest.fn()} onClear={jest.fn()} />);
    expect(screen.getByText(`2/${MAX_COMPARISON_ITEMS} selected`)).toBeInTheDocument();
  });

  it('calls onRemove when a chip remove button is clicked', () => {
    const onRemove = jest.fn();
    const selected = [listing({ listingId: 'L1', projectName: 'Amazon Reforestation' })];
    render(<ComparisonTray selected={selected} onRemove={onRemove} onClear={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Amazon Reforestation from comparison' }));
    expect(onRemove).toHaveBeenCalledWith('L1');
  });

  it('calls onClear when "Clear all" is clicked', () => {
    const onClear = jest.fn();
    const selected = [listing({ listingId: 'L1' })];
    render(<ComparisonTray selected={selected} onRemove={jest.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('disables the Compare button with fewer than 2 selections', () => {
    const selected = [listing({ listingId: 'L1' })];
    render(<ComparisonTray selected={selected} onRemove={jest.fn()} onClear={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();
  });

  it('opens a side-by-side comparison table with 2+ selections', () => {
    const selected = [
      listing({ listingId: 'L1', projectName: 'Amazon Reforestation', pricePerCredit: '100000000' }),
      listing({ listingId: 'L2', projectName: 'Kenya Solar', methodology: 'Gold Standard', pricePerCredit: '200000000' }),
    ];
    render(<ComparisonTray selected={selected} onRemove={jest.fn()} onClear={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

    expect(screen.getByRole('dialog', { name: 'Compare listings' })).toBeInTheDocument();
    expect(screen.getAllByText('Amazon Reforestation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Kenya Solar').length).toBeGreaterThan(0);
    expect(screen.getByText('VCS')).toBeInTheDocument();
    expect(screen.getByText('Gold Standard')).toBeInTheDocument();
  });
});
