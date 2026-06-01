import { Test, TestingModule } from '@nestjs/testing';
import { StellarNetworkService } from './stellar-network.service';

const mockGetLatestLedger = jest.fn().mockResolvedValue({ sequence: 123 });

jest.mock('@stellar/stellar-sdk', () => ({
  SorobanRpc: {
    Server: jest.fn().mockImplementation(() => ({
      getLatestLedger: mockGetLatestLedger,
    })),
  },
}));

describe('StellarNetworkService', () => {
  let service: StellarNetworkService;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [StellarNetworkService],
    }).compile();

    service = module.get(StellarNetworkService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('reports healthy when Horizon and Soroban RPC are reachable', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: jest.fn() });

    const result = await service.checkConnectivity();

    expect(result.healthy).toBe(true);
    expect(result.horizon.healthy).toBe(true);
    expect(result.rpc.healthy).toBe(true);
    expect(mockGetLatestLedger).toHaveBeenCalled();
  });

  it('returns degraded when Horizon is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network failure'));

    const result = await service.checkConnectivity();

    expect(result.healthy).toBe(false);
    expect(result.horizon.healthy).toBe(false);
    expect(result.horizon.details).toContain('network failure');
  });

  it('returns degraded when Soroban RPC is unreachable', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: jest.fn() });
    mockGetLatestLedger.mockRejectedValueOnce(new Error('rpc failure'));

    const result = await service.checkConnectivity();

    expect(result.healthy).toBe(false);
    expect(result.rpc.healthy).toBe(false);
    expect(result.rpc.details).toContain('rpc failure');
  });
});
