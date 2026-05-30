import {
  getWalletErrorMessage,
  isWalletError,
  WalletErrorCode,
} from '../lib/wallet-errors';

const ALL_CODES: WalletErrorCode[] = [
  'WALLET_NOT_INSTALLED',
  'WALLET_PERMISSION_DENIED',
  'WRONG_NETWORK',
  'TRANSACTION_REJECTED',
  'INSUFFICIENT_XLM',
  'ACCOUNT_NOT_ACTIVATED',
  'UNKNOWN',
];

describe('getWalletErrorMessage', () => {
  it.each(ALL_CODES)('returns a non-empty human-readable message for %s', (code) => {
    const msg = getWalletErrorMessage(code);
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('returns UNKNOWN message for unrecognised string', () => {
    const msg = getWalletErrorMessage('SOME_RANDOM_CODE');
    expect(msg).toBe(getWalletErrorMessage('UNKNOWN'));
  });

  it('returns human-readable message when passed an Error object with a known code', () => {
    const err = new Error('WALLET_NOT_INSTALLED');
    const msg = getWalletErrorMessage(err);
    expect(msg).toBe(getWalletErrorMessage('WALLET_NOT_INSTALLED'));
  });

  it('returns the error message when passed an Error with an unknown message', () => {
    const err = new Error('Something went wrong');
    const msg = getWalletErrorMessage(err);
    expect(msg).toBe('Something went wrong');
  });

  it('returns UNKNOWN message for null/undefined', () => {
    expect(getWalletErrorMessage(null)).toBe(getWalletErrorMessage('UNKNOWN'));
    expect(getWalletErrorMessage(undefined)).toBe(getWalletErrorMessage('UNKNOWN'));
  });

  it('WALLET_NOT_INSTALLED message mentions Freighter', () => {
    expect(getWalletErrorMessage('WALLET_NOT_INSTALLED')).toMatch(/freighter/i);
  });

  it('WRONG_NETWORK message mentions network or testnet', () => {
    expect(getWalletErrorMessage('WRONG_NETWORK')).toMatch(/network|testnet/i);
  });

  it('INSUFFICIENT_XLM message mentions XLM', () => {
    expect(getWalletErrorMessage('INSUFFICIENT_XLM')).toMatch(/XLM/i);
  });
});

describe('isWalletError', () => {
  it('returns true when string matches code', () => {
    expect(isWalletError('WALLET_NOT_INSTALLED', 'WALLET_NOT_INSTALLED')).toBe(true);
  });

  it('returns false when string does not match code', () => {
    expect(isWalletError('WRONG_NETWORK', 'WALLET_NOT_INSTALLED')).toBe(false);
  });

  it('returns true when Error message matches code', () => {
    const err = new Error('TRANSACTION_REJECTED');
    expect(isWalletError(err, 'TRANSACTION_REJECTED')).toBe(true);
  });

  it('returns false when Error message does not match code', () => {
    const err = new Error('some other error');
    expect(isWalletError(err, 'TRANSACTION_REJECTED')).toBe(false);
  });

  it('returns false for non-string, non-Error values', () => {
    expect(isWalletError(42, 'UNKNOWN')).toBe(false);
    expect(isWalletError(null, 'UNKNOWN')).toBe(false);
  });
});
