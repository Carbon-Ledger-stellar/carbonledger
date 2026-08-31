import { renderHook, act } from '@testing-library/react-hooks';
import { useFreighter } from '../useFreighter';

// Mock Freighter API
const mockFreighterApi = {
    isConnected: jest.fn(),
    getPublicKey: jest.fn(),
    signTransaction: jest.fn(),
    setAllowed: jest.fn(),
};

beforeAll(() => {
    global.window.freighterApi = mockFreighterApi;
});

describe('useFreighter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return initial state', () => {
        const { result } = renderHook(() => useFreighter());
        expect(result.current.status).toBe('idle');
        expect(result.current.wallet.isConnected).toBe(false);
        expect(result.current.wallet.publicKey).toBeNull();
    });

    it('should connect to wallet successfully', async () => {
        const mockPublicKey = 'GABC1234567890';
        mockFreighterApi.getPublicKey.mockResolvedValue(mockPublicKey);
        mockFreighterApi.isConnected.mockResolvedValue(true);

        const { result, waitForNextUpdate } = renderHook(() => useFreighter());

        await act(async () => {
            await result.current.connect();
        });

        await waitForNextUpdate();

        expect(result.current.status).toBe('connected');
        expect(result.current.wallet.isConnected).toBe(true);
        expect(result.current.wallet.publicKey).toBe(mockPublicKey);
    });

    it('should handle connection error', async () => {
        mockFreighterApi.getPublicKey.mockRejectedValue(
            new Error('Connection failed')
        );

        const { result, waitForNextUpdate } = renderHook(() => useFreighter());

        await act(async () => {
            await result.current.connect();
        });

        await waitForNextUpdate();

        expect(result.current.status).toBe('error');
        expect(result.current.error).toBeDefined();
        expect(result.current.error?.message).toBe('Connection failed');
    });

    it('should disconnect wallet', () => {
        const { result } = renderHook(() => useFreighter());

        act(() => {
            result.current.disconnect();
        });

        expect(result.current.status).toBe('disconnected');
        expect(result.current.wallet.isConnected).toBe(false);
        expect(result.current.wallet.publicKey).toBeNull();
    });

    it('should abbreviate public key', () => {
        const { result } = renderHook(() => useFreighter());
        
        // Set wallet with public key
        act(() => {
            result.current.wallet.publicKey = 'GABC1234567890DEF';
        });

        expect(result.current.abbreviatedPublicKey).toBe('GABC12...89DEF');
    });
});
