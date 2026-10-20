import React from 'react';

/**
 * Format a USDC amount (in stroops / 7-decimal Stellar precision) as a string.
 * Uses string math to avoid floating-point rounding errors.
 *
 * @param amount - raw amount string (7-decimal precision) or number
 * @param decimals - number of decimals to display (default 2)
 */
export function formatPrice(amount: string | number | bigint, decimals = 2): string {
  const raw = typeof amount === 'bigint' ? amount.toString() : String(amount);
  const negative = raw.startsWith('-');
  const digits = negative ? raw.slice(1) : raw;
  const [intPartRaw, fracPartRaw = ''] = digits.split('.');
  const intPart = intPartRaw === '' ? '0' : intPartRaw;
  const fracPart = (fracPartRaw + '0000000').slice(0, 7);

  if (decimals <= 0) {
    return `${negative ? '-' : ''}${intPart}`;
  }

  const shown = fracPart.slice(0, Math.min(decimals, 7));
  return `${negative ? '-' : ''}${intPart}.${shown}`;
}

/**
 * Full 7-decimal Stellar precision string, used for tooltips.
 */
export function formatPriceFull(amount: string | number | bigint): string {
  return formatPrice(amount, 7);
}

interface TransactionPreviewProps {
  amount?: string | number | bigint;
  fee?: string | number | bigint;
  total?: string | number | bigint;
  [key: string]: unknown;
}

const TransactionPreview: React.FC<TransactionPreviewProps> = ({ amount, fee, total }) => {
  const renderPrice = (value: string | number | bigint | undefined) => {
    if (value === undefined || value === null) return null;
    return (
      <span title={formatPriceFull(value)}>
        {formatPrice(value)} USDC
      </span>
    );
  };

  return (
    <div className="transaction-preview">
      {amount !== undefined && (
        <div className="transaction-preview__row">
          <span className="transaction-preview__label">Amount</span>
          <span className="transaction-preview__value">{renderPrice(amount)}</span>
        </div>
      )}
      {fee !== undefined && (
        <div className="transaction-preview__row">
          <span className="transaction-preview__label">Fee</span>
          <span className="transaction-preview__value">{renderPrice(fee)}</span>
        </div>
      )}
      {total !== undefined && (
        <div className="transaction-preview__row">
          <span className="transaction-preview__label">Total</span>
          <span className="transaction-preview__value">{renderPrice(total)}</span>
        </div>
      )}
    </div>
  );
};

export default TransactionPreview;
