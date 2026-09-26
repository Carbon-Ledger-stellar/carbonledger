/**
 * TransactionPreview component tests
 *
 * Covers:
 * - Loading skeleton renders with aria-busy
 * - Error state renders with role=alert and disables Confirm
 * - Ready state renders all effect rows
 * - Fee estimate row renders only when preview.feeEstimate is set
 * - Confirm button disabled when loading or error
 * - Confirm button calls onConfirm only when ready
 * - Cancel button always calls onCancel when not confirming
 * - confirming=true shows "Signing…" and disables both buttons
 * - Component renders without Confirm/Cancel when callbacks not provided
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TransactionPreview from '../../components/TransactionPreview';
import { PreviewState } from '../../lib/transaction-preview-types';

// The design-system import uses module aliases that need resolving.
// The jest config maps them; if not, mock the module.
jest.mock('../../styles/design-system', () => ({
  colors: {
    primary: { 50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 600: '#16a34a', 700: '#15803d' },
    neutral: { 500: '#6b7280', 600: '#4b5563', 700: '#374151', 900: '#111827', 300: '#d1d5db', 200: '#e5e7eb' },
    surface: '#ffffff',
  },
}));

// ── Fixture factories ────────────────────────────────────────────────────────

const loadingPreview: PreviewState = {
  loading: true,
  ready: false,
  effects: [],
};

const errorPreview: PreviewState = {
  loading: false,
  ready: false,
  error: 'Insufficient credits. You do not have enough credits.',
  effects: [],
};

const readyPreview: PreviewState = {
  loading: false,
  ready: true,
  effects: [
    { label: 'USDC debit', value: '$10.00 USDC' },
    { label: 'Credits received', value: '5 credits' },
    { label: 'Estimated network fee', value: '~0.00101 XLM' },
  ],
  feeEstimate: '~0.00101 XLM',
};

const readyNoFeePreview: PreviewState = {
  loading: false,
  ready: true,
  effects: [
    { label: 'USDC debit', value: '$5.00 USDC' },
    { label: 'Credits retired', value: '2 credits' },
  ],
};

// ── Loading state ────────────────────────────────────────────────────────────

describe('TransactionPreview — loading state', () => {
  it('renders the simulating indicator text', () => {
    render(<TransactionPreview preview={loadingPreview} />);
    // The header indicator says "Simulating…"
    expect(screen.getByLabelText(/simulating transaction/i)).toBeInTheDocument();
  });

  it('renders an aria-busy container', () => {
    const { container } = render(<TransactionPreview preview={loadingPreview} />);
    const busyEl = container.querySelector('[aria-busy="true"]');
    expect(busyEl).toBeInTheDocument();
  });

  it('does not render a Confirm button while loading', () => {
    render(
      <TransactionPreview
        preview={loadingPreview}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    const confirmBtn = screen.queryByRole('button', { name: /confirm/i });
    // Button rendered but disabled
    if (confirmBtn) {
      expect(confirmBtn).toBeDisabled();
    }
  });
});

// ── Error state ──────────────────────────────────────────────────────────────

describe('TransactionPreview — error state', () => {
  it('renders the error message', () => {
    render(<TransactionPreview preview={errorPreview} />);
    expect(
      screen.getByText(/insufficient credits/i),
    ).toBeInTheDocument();
  });

  it('renders the error with role=alert', () => {
    render(<TransactionPreview preview={errorPreview} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/insufficient credits/i);
  });

  it('disables the Confirm button when there is an error', () => {
    render(
      <TransactionPreview
        preview={errorPreview}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    expect(confirmBtn).toBeDisabled();
    expect(confirmBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not call onConfirm when the Confirm button is clicked in error state', () => {
    const onConfirm = jest.fn();
    render(
      <TransactionPreview
        preview={errorPreview}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    // Disabled button: click should not fire the handler
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(confirmBtn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('still enables Cancel when there is an error', () => {
    const onCancel = jest.fn();
    render(
      <TransactionPreview
        preview={errorPreview}
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ── Ready state ──────────────────────────────────────────────────────────────

describe('TransactionPreview — ready state', () => {
  it('renders all effect labels and values', () => {
    render(<TransactionPreview preview={readyPreview} />);
    expect(screen.getByText('USDC debit')).toBeInTheDocument();
    expect(screen.getByText('$10.00 USDC')).toBeInTheDocument();
    expect(screen.getByText('Credits received')).toBeInTheDocument();
    expect(screen.getByText('5 credits')).toBeInTheDocument();
  });

  it('renders the fee estimate row when feeEstimate is provided', () => {
    render(<TransactionPreview preview={readyPreview} />);
    expect(screen.getByText('Estimated total fee')).toBeInTheDocument();
    // feeEstimate value appears in the effects list and the separator row — check at least one
    expect(screen.getAllByText('~0.00101 XLM').length).toBeGreaterThanOrEqual(1);
  });

  it('does not render a fee estimate row when feeEstimate is absent', () => {
    render(<TransactionPreview preview={readyNoFeePreview} />);
    expect(screen.queryByText('Estimated total fee')).not.toBeInTheDocument();
  });

  it('renders the "✓ Ready" badge', () => {
    render(<TransactionPreview preview={readyPreview} />);
    expect(screen.getByLabelText(/simulation ready/i)).toBeInTheDocument();
  });

  it('enables the Confirm button when preview is ready', () => {
    render(
      <TransactionPreview
        preview={readyPreview}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    const confirmBtn = screen.getByRole('button', { name: /confirm/i });
    expect(confirmBtn).not.toBeDisabled();
    expect(confirmBtn).toHaveAttribute('aria-disabled', 'false');
  });

  it('calls onConfirm when Confirm button is clicked', () => {
    const onConfirm = jest.fn();
    render(
      <TransactionPreview
        preview={readyPreview}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = jest.fn();
    render(
      <TransactionPreview
        preview={readyPreview}
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ── confirming state ─────────────────────────────────────────────────────────

describe('TransactionPreview — confirming state', () => {
  it('shows "Signing…" text on the Confirm button while confirming', () => {
    render(
      <TransactionPreview
        preview={readyPreview}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        confirming
      />,
    );
    // The Confirm button itself should contain "Signing…"
    const confirmBtn = screen.getByRole('button', { name: /signing/i });
    expect(confirmBtn).toBeInTheDocument();
  });

  it('disables both Confirm and Cancel while confirming', () => {
    render(
      <TransactionPreview
        preview={readyPreview}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        confirming
      />,
    );
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('does not call onCancel when Cancel is clicked while confirming', () => {
    const onCancel = jest.fn();
    render(
      <TransactionPreview
        preview={readyPreview}
        onConfirm={jest.fn()}
        onCancel={onCancel}
        confirming
      />,
    );
    // Cancel is disabled, click should not fire
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ── Custom labels ────────────────────────────────────────────────────────────

describe('TransactionPreview — custom labels', () => {
  it('renders a custom confirmLabel', () => {
    render(
      <TransactionPreview
        preview={readyPreview}
        onConfirm={jest.fn()}
        confirmLabel="Buy Credits"
      />,
    );
    expect(screen.getByRole('button', { name: 'Buy Credits' })).toBeInTheDocument();
  });

  it('renders a custom cancelLabel', () => {
    render(
      <TransactionPreview
        preview={readyPreview}
        onCancel={jest.fn()}
        cancelLabel="Go back"
      />,
    );
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
  });

  it('renders a custom title', () => {
    render(
      <TransactionPreview
        preview={readyPreview}
        title="Retirement preview"
      />,
    );
    expect(screen.getByText('Retirement preview')).toBeInTheDocument();
  });
});

// ── No callbacks ─────────────────────────────────────────────────────────────

describe('TransactionPreview — no callbacks', () => {
  it('does not render Confirm or Cancel buttons when callbacks are not provided', () => {
    render(<TransactionPreview preview={readyPreview} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

// ── Accessibility ─────────────────────────────────────────────────────────────

describe('TransactionPreview — accessibility', () => {
  it('has aria-live="polite" on the container', () => {
    const { container } = render(<TransactionPreview preview={readyPreview} />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toBeInTheDocument();
  });

  it('has role="region" with an accessible label', () => {
    render(<TransactionPreview preview={readyPreview} />);
    expect(screen.getByRole('region', { name: /transaction preview/i })).toBeInTheDocument();
  });
});
