const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();
const mockGetEvents = jest.fn();
const mockFromXDR = jest.fn();

const mockTx = { sign: jest.fn() };

// TransactionBuilder needs fromXDR as a static method on the constructor
function MockTransactionBuilder() {
  return {
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue(mockTx),
  };
}
MockTransactionBuilder.fromXDR = mockFromXDR;

jest.mock('@stellar/stellar-sdk', () => ({
  SorobanRpc: {
    Server: jest.fn().mockImplementation(() => ({
      getAccount: mockGetAccount,
      simulateTransaction: mockSimulateTransaction,
      sendTransaction: mockSendTransaction,
      getTransaction: mockGetTransaction,
      getEvents: mockGetEvents,
    })),
    Api: {
      GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED' },
    },
  },
  TransactionBuilder: MockTransactionBuilder,
  Networks: {
    PUBLIC: 'Public Global Stellar Network',
    TESTNET: 'Test SDF Network ; September 2015',
  },
  BASE_FEE: '100',
  xdr: {
    ScVal: {},
    HostFunction: { hostFunctionTypeInvokeContract: jest.fn(() => ({})) },
    InvokeContractArgs: jest.fn(),
  },
  scValToNative: jest.fn((v) => ({ parsed: true, raw: v })),
  nativeToScVal: jest.fn((v) => v),
  Address: jest.fn().mockImplementation(() => ({ toScAddress: jest.fn() })),
}));

import {
  parseCarbonCredit,
  parseRetirementCertificate,
  parseMarketListing,
  simulateContract,
  invokeContract,
  getContractEvents,
} from '../lib/soroban';
import { scValToNative } from '@stellar/stellar-sdk';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAccount.mockResolvedValue({ id: 'GTEST' });
  mockSimulateTransaction.mockResolvedValue({ result: {} });
  mockFromXDR.mockReturnValue(mockTx);
  mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'txhash123' });
  mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });
  mockGetEvents.mockResolvedValue({ events: [{ id: 'evt1' }] });
});

describe('parseCarbonCredit', () => {
  it('calls scValToNative and returns the result', () => {
    const mockVal = {} as any;
    const result = parseCarbonCredit(mockVal);
    expect(scValToNative).toHaveBeenCalledWith(mockVal);
    expect(result).toEqual({ parsed: true, raw: mockVal });
  });
});

describe('parseRetirementCertificate', () => {
  it('calls scValToNative and returns the result', () => {
    const mockVal = {} as any;
    const result = parseRetirementCertificate(mockVal);
    expect(scValToNative).toHaveBeenCalledWith(mockVal);
    expect(result).toEqual({ parsed: true, raw: mockVal });
  });
});

describe('parseMarketListing', () => {
  it('calls scValToNative and returns the result', () => {
    const mockVal = {} as any;
    const result = parseMarketListing(mockVal);
    expect(scValToNative).toHaveBeenCalledWith(mockVal);
    expect(result).toEqual({ parsed: true, raw: mockVal });
  });
});

describe('simulateContract', () => {
  it('calls sorobanServer.simulateTransaction', async () => {
    const params = {
      contractId: 'CTEST',
      method: 'get_project',
      args: [],
      sourcePublicKey: 'GTEST',
    };
    const result = await simulateContract(params);
    expect(mockGetAccount).toHaveBeenCalledWith('GTEST');
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ result: {} });
  });
});

describe('invokeContract', () => {
  it('returns hash on SUCCESS', async () => {
    const hash = await invokeContract(
      { contractId: 'C', method: 'm', args: [], sourcePublicKey: 'G' },
      'signedXDR',
    );
    expect(hash).toBe('txhash123');
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
  });

  it('throws on ERROR status', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'ERROR', errorResult: 'bad' });
    await expect(
      invokeContract({ contractId: 'C', method: 'm', args: [], sourcePublicKey: 'G' }, 'xdr'),
    ).rejects.toThrow('Contract invocation failed');
  });

  it('throws on FAILED transaction', async () => {
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'h' });
    mockGetTransaction.mockResolvedValue({ status: 'FAILED' });
    await expect(
      invokeContract({ contractId: 'C', method: 'm', args: [], sourcePublicKey: 'G' }, 'xdr'),
    ).rejects.toThrow('Transaction failed on-chain');
  });
});

describe('getContractEvents', () => {
  it('returns events array', async () => {
    const events = await getContractEvents('CONTRACT_ID', 1000);
    expect(mockGetEvents).toHaveBeenCalledWith({
      startLedger: 1000,
      filters: [{ type: 'contract', contractIds: ['CONTRACT_ID'] }],
    });
    expect(events).toEqual([{ id: 'evt1' }]);
  });
});
