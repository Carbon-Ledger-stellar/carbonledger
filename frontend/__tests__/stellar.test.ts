const mockSubmitTransaction = jest.fn();
const mockLoadAccount = jest.fn();
const mockFromXDR = jest.fn();

function MockTransactionBuilder(this: any) {
  return {
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({ sign: jest.fn() }),
  };
}
MockTransactionBuilder.fromXDR = mockFromXDR;

jest.mock('@stellar/stellar-sdk', () => {
  const mockKeypair = {
    publicKey: () => 'GTEST123PUBLIC',
    sign: jest.fn(),
    verify: jest.fn(() => true),
  };
  return {
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        loadAccount: mockLoadAccount,
        submitTransaction: mockSubmitTransaction,
      })),
    },
    Keypair: {
      random: jest.fn(() => mockKeypair),
      fromPublicKey: jest.fn(() => mockKeypair),
    },
    Networks: {
      PUBLIC: 'Public Global Stellar Network',
      TESTNET: 'Test SDF Network ; September 2015',
    },
    TransactionBuilder: MockTransactionBuilder,
    BASE_FEE: '100',
    Asset: jest.fn().mockImplementation(() => ({})),
    Operation: {
      payment: jest.fn().mockReturnValue({}),
      changeTrust: jest.fn().mockReturnValue({}),
    },
    Account: jest.fn(),
  };
});

// Mock global fetch for fundTestnetAccount
global.fetch = jest.fn();

import {
  formatStroops,
  parseStroops,
  createStellarAccount,
  fundTestnetAccount,
  submitTransaction,
  issueAsset,
  createTrustline,
} from '../lib/stellar';

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadAccount.mockResolvedValue({ id: 'GTEST123PUBLIC', balances: [] });
  mockSubmitTransaction.mockResolvedValue({ hash: 'txhash123' });
  mockFromXDR.mockReturnValue({ sign: jest.fn() });
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
});

describe('formatStroops', () => {
  it('formats whole number stroops', () => {
    expect(formatStroops(10_000_000n)).toBe('1');
  });

  it('formats fractional stroops', () => {
    expect(formatStroops(10_500_000n)).toBe('1.05');
  });

  it('formats zero', () => {
    expect(formatStroops(0n)).toBe('0');
  });

  it('accepts number input', () => {
    expect(formatStroops(10_000_000)).toBe('1');
  });

  it('accepts string input', () => {
    expect(formatStroops('10000000')).toBe('1');
  });

  it('strips trailing zeros from fractional part', () => {
    expect(formatStroops(15_000_000n)).toBe('1.5');
  });

  it('formats large amounts', () => {
    expect(formatStroops(1_000_000_000n)).toBe('100');
  });
});

describe('parseStroops', () => {
  it('parses whole number USDC', () => {
    expect(parseStroops('1')).toBe(10_000_000n);
  });

  it('parses fractional USDC', () => {
    expect(parseStroops('1.5')).toBe(15_000_000n);
  });

  it('parses zero', () => {
    expect(parseStroops('0')).toBe(0n);
  });

  it('parses 7-decimal USDC', () => {
    expect(parseStroops('1.0000001')).toBe(10_000_001n);
  });

  it('round-trips with formatStroops', () => {
    const original = 12_345_678n;
    const formatted = formatStroops(original);
    expect(parseStroops(formatted)).toBe(original);
  });

  it('truncates beyond 7 decimal places', () => {
    expect(parseStroops('1.12345678')).toBe(11_234_567n);
  });
});

describe('createStellarAccount', () => {
  it('returns a keypair', async () => {
    const kp = await createStellarAccount();
    expect(kp).toBeDefined();
    expect(typeof kp.publicKey()).toBe('string');
  });
});

describe('fundTestnetAccount', () => {
  it('calls friendbot with the public key', async () => {
    await fundTestnetAccount('GTEST123PUBLIC');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://friendbot.stellar.org?addr=GTEST123PUBLIC',
    );
  });

  it('throws when friendbot returns non-ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    await expect(fundTestnetAccount('GTEST123PUBLIC')).rejects.toThrow('Friendbot funding failed');
  });
});

describe('submitTransaction', () => {
  it('submits a transaction and returns the response', async () => {
    const result = await submitTransaction('someXDR');
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ hash: 'txhash123' });
  });
});

describe('issueAsset', () => {
  it('submits a transaction and returns hash', async () => {
    const { Keypair } = await import('@stellar/stellar-sdk');
    const issuer = Keypair.fromPublicKey('GTEST123PUBLIC');
    const hash = await issueAsset(issuer, 'CBON', 'GDIST123', '1000');
    expect(hash).toBe('txhash123');
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('createTrustline', () => {
  it('submits a transaction and returns hash', async () => {
    const { Keypair } = await import('@stellar/stellar-sdk');
    const account = Keypair.fromPublicKey('GTEST123PUBLIC');
    const hash = await createTrustline(account, 'CBON', 'GISSUER123');
    expect(hash).toBe('txhash123');
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
  });
});
