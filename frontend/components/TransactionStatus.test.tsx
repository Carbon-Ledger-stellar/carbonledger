import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TransactionStatus from './TransactionStatus';

describe('TransactionStatus', () => {
  it('renders building state', () => {
    render(<TransactionStatus status="building" />);
    expect(screen.getByText('Building transaction…')).toBeInTheDocument();
    expect(screen.getByText('🔄')).toBeInTheDocument();
  });

  it('renders signing state', () => {
    render(<TransactionStatus status="signing" />);
    expect(screen.getByText('Waiting for signature…')).toBeInTheDocument();
  });

  it('renders failed state with carbon error', () => {
    // CarbonError(1) is "Project already exists."
    render(<TransactionStatus status="failed" message="CarbonError(1)" />);
    expect(screen.getByText('Transaction failed')).toBeInTheDocument();
    expect(screen.getByText('Project already exists.')).toBeInTheDocument();
  });

  it('renders retry button when onRetry is provided', () => {
    const onRetry = jest.fn();
    render(<TransactionStatus status="failed" onRetry={onRetry} />);
    const retryButton = screen.getByText('Retry');
    expect(retryButton).toBeInTheDocument();
    retryButton.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders stellar explorer link', () => {
    const txHash = 'abc123def456abc123def456abc123def456';
    render(<TransactionStatus status="confirmed" txHash={txHash} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `https://stellar.expert/explorer/testnet/tx/${txHash}`);
    expect(screen.getByText(/View on Explorer/)).toBeInTheDocument();
  });
});
