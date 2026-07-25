/**
 * Tests for the Freighter wallet connection state machine.
 *
 * Covers:
 *  - All valid state transitions
 *  - Guard helpers (canConnect, canRetry)
 *  - performConnect orchestrator with mocked Freighter API
 *  - Error recovery flows
 *  - Network-switch detection
 *  - Account-change detection
 */

import {
  walletReducer,
  INITIAL_STATE,
  WalletConnectionState,
  WalletEvent,
  canConnect,
  canRetry,
  isTerminal,
  performConnect,
  performDisconnect,
  performNetworkCheck,
  ConnectionStatus,
} from '../lib/wallet-state-machine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateWith(overrides: Partial<WalletConnectionState>): WalletConnectionState {
  return { ...INITIAL_STATE, ...overrides };
}

function dispatch(events: WalletEvent[], initial = INITIAL_STATE): WalletConnectionState {
  return events.reduce(walletReducer, initial);
}

// ---------------------------------------------------------------------------
// Mock freighter lib
// ---------------------------------------------------------------------------

jest.mock('../lib/freighter', () => ({
  isFreighterInstalled: jest.fn(),
  isFreighterConnected: jest.fn(),
  connectFreighter: jest.fn(),
  checkNetwork: jest.fn(),
  isWrongNetwork: jest.fn(),
}));

import {
  isFreighterInstalled,
  connectFreighter,
  checkNetwork,
  isWrongNetwork,
} from '../lib/freighter';

const mockInstalled = isFreighterInstalled as jest.MockedFunction<typeof isFreighterInstalled>;
const mockConnect = connectFreighter as jest.MockedFunction<typeof connectFreighter>;
const mockCheckNetwork = checkNetwork as jest.MockedFunction<typeof checkNetwork>;
const mockIsWrongNetwork = isWrongNetwork as jest.MockedFunction<typeof isWrongNetwork>;

// ---------------------------------------------------------------------------
// State machine — reducer unit tests
// ---------------------------------------------------------------------------

describe('walletReducer — initial state', () => {
  it('starts disconnected with all null fields', () => {
    expect(INITIAL_STATE.status).toBe('disconnected');
    expect(INITIAL_STATE.publicKey).toBeNull();
    expect(INITIAL_STATE.network).toBeNull();
    expect(INITIAL_STATE.errorMessage).toBeNull();
    expect(INITIAL_STATE.errorCode).toBeNull();
    expect(INITIAL_STATE.connectedAt).toBeNull();
  });
});

describe('walletReducer — CONNECT transition', () => {
  it('moves disconnected → connecting', () => {
    const next = walletReducer(INITIAL_STATE, { type: 'CONNECT' });
    expect(next.status).toBe('connecting');
  });

  it('moves error → connecting', () => {
    const errState = stateWith({ status: 'error', errorCode: 'UNKNOWN', errorMessage: 'err' });
    const next = walletReducer(errState, { type: 'CONNECT' });
    expect(next.status).toBe('connecting');
  });

  it('is a no-op when already connecting', () => {
    const connectingState = stateWith({ status: 'connecting' });
    const next = walletReducer(connectingState, { type: 'CONNECT' });
    expect(next.status).toBe('connecting');
    expect(next).toBe(connectingState); // same reference
  });

  it('is a no-op when already connected', () => {
    const connectedState = stateWith({ status: 'connected', publicKey: 'GABC' });
    const next = walletReducer(connectedState, { type: 'CONNECT' });
    expect(next).toBe(connectedState);
  });

  it('clears previous error fields when retrying', () => {
    const errState = stateWith({ status: 'error', errorCode: 'WALLET_PERMISSION_DENIED', errorMessage: 'denied' });
    const next = walletReducer(errState, { type: 'CONNECT' });
    expect(next.errorCode).toBeNull();
    expect(next.errorMessage).toBeNull();
  });
});

describe('walletReducer — CONNECT_SUCCESS transition', () => {
  it('moves connecting → connected with key + network', () => {
    const connecting = stateWith({ status: 'connecting' });
    const next = walletReducer(connecting, {
      type: 'CONNECT_SUCCESS',
      publicKey: 'GABCDEF',
      network: 'TESTNET',
    });
    expect(next.status).toBe('connected');
    expect(next.publicKey).toBe('GABCDEF');
    expect(next.network).toBe('TESTNET');
    expect(next.errorMessage).toBeNull();
    expect(next.connectedAt).not.toBeNull();
  });

  it('is a no-op when not connecting', () => {
    const already = stateWith({ status: 'connected', publicKey: 'GEXISTING' });
    const next = walletReducer(already, {
      type: 'CONNECT_SUCCESS',
      publicKey: 'GNEW',
      network: 'TESTNET',
    });
    expect(next).toBe(already);
  });
});

describe('walletReducer — CONNECT_FAILURE transition', () => {
  it('moves connecting → error with message and code', () => {
    const connecting = stateWith({ status: 'connecting' });
    const next = walletReducer(connecting, {
      type: 'CONNECT_FAILURE',
      errorCode: 'WALLET_PERMISSION_DENIED',
      errorMessage: 'Permission denied.',
    });
    expect(next.status).toBe('error');
    expect(next.errorCode).toBe('WALLET_PERMISSION_DENIED');
    expect(next.errorMessage).toBe('Permission denied.');
  });

  it('is a no-op when not connecting', () => {
    const disconnected = INITIAL_STATE;
    const next = walletReducer(disconnected, {
      type: 'CONNECT_FAILURE',
      errorCode: 'UNKNOWN',
      errorMessage: 'err',
    });
    expect(next).toBe(disconnected);
  });
});

describe('walletReducer — DISCONNECT transition', () => {
  it('resets to disconnected from connected', () => {
    const connected = stateWith({ status: 'connected', publicKey: 'GABC', network: 'TESTNET', connectedAt: 12345 });
    const next = walletReducer(connected, { type: 'DISCONNECT' });
    expect(next.status).toBe('disconnected');
    expect(next.publicKey).toBeNull();
    expect(next.network).toBeNull();
  });

  it('resets from error state', () => {
    const errState = stateWith({ status: 'error', errorCode: 'UNKNOWN', errorMessage: 'err' });
    const next = walletReducer(errState, { type: 'DISCONNECT' });
    expect(next.status).toBe('disconnected');
    expect(next.errorCode).toBeNull();
  });
});

describe('walletReducer — NETWORK_CHANGED transition', () => {
  it('moves connected → network_switch when network is not TESTNET', () => {
    const connected = stateWith({ status: 'connected', publicKey: 'GABC', network: 'TESTNET' });
    const next = walletReducer(connected, { type: 'NETWORK_CHANGED', network: 'PUBLIC' });
    expect(next.status).toBe('network_switch');
    expect(next.errorCode).toBe('WRONG_NETWORK');
    expect(next.network).toBe('PUBLIC');
  });

  it('moves network_switch → connected when network switches back to TESTNET', () => {
    const switchState = stateWith({
      status: 'network_switch',
      publicKey: 'GABC',
      network: 'PUBLIC',
      errorCode: 'WRONG_NETWORK',
      errorMessage: 'wrong network',
    });
    const next = walletReducer(switchState, { type: 'NETWORK_CHANGED', network: 'TESTNET' });
    expect(next.status).toBe('connected');
    expect(next.errorCode).toBeNull();
    expect(next.errorMessage).toBeNull();
  });

  it('is a no-op when disconnected', () => {
    const next = walletReducer(INITIAL_STATE, { type: 'NETWORK_CHANGED', network: 'PUBLIC' });
    expect(next).toBe(INITIAL_STATE);
  });
});

describe('walletReducer — ACCOUNT_CHANGED transition', () => {
  it('moves connected → account_changed with new public key', () => {
    const connected = stateWith({ status: 'connected', publicKey: 'GABC', network: 'TESTNET' });
    const next = walletReducer(connected, { type: 'ACCOUNT_CHANGED', publicKey: 'GNEW' });
    expect(next.status).toBe('account_changed');
    expect(next.publicKey).toBe('GNEW');
    expect(next.errorMessage).toMatch(/account changed/i);
    expect(next.connectedAt).toBeNull();
  });

  it('is a no-op when disconnected', () => {
    const next = walletReducer(INITIAL_STATE, { type: 'ACCOUNT_CHANGED', publicKey: 'GNEW' });
    expect(next).toBe(INITIAL_STATE);
  });
});

describe('walletReducer — RETRY transition', () => {
  it('moves error → connecting', () => {
    const errState = stateWith({ status: 'error', errorCode: 'UNKNOWN', errorMessage: 'err' });
    const next = walletReducer(errState, { type: 'RETRY' });
    expect(next.status).toBe('connecting');
  });

  it('moves network_switch → connecting', () => {
    const nsState = stateWith({ status: 'network_switch', publicKey: 'GABC', network: 'PUBLIC' });
    const next = walletReducer(nsState, { type: 'RETRY' });
    expect(next.status).toBe('connecting');
  });

  it('moves account_changed → connecting', () => {
    const acState = stateWith({ status: 'account_changed', publicKey: 'GABC' });
    const next = walletReducer(acState, { type: 'RETRY' });
    expect(next.status).toBe('connecting');
  });

  it('is a no-op when connected', () => {
    const connected = stateWith({ status: 'connected', publicKey: 'GABC' });
    const next = walletReducer(connected, { type: 'RETRY' });
    expect(next).toBe(connected);
  });
});

describe('walletReducer — RESET transition', () => {
  it('resets from any state to initial disconnected', () => {
    const connected = stateWith({ status: 'connected', publicKey: 'GABC', network: 'TESTNET', connectedAt: 999 });
    const next = walletReducer(connected, { type: 'RESET' });
    expect(next).toEqual(INITIAL_STATE);
  });
});

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

describe('guard helpers', () => {
  const statuses: ConnectionStatus[] = [
    'disconnected', 'connecting', 'connected', 'error', 'network_switch', 'account_changed',
  ];

  it.each(statuses)('canConnect(%s)', (status) => {
    const result = canConnect(status);
    expect(result).toBe(status === 'disconnected' || status === 'error');
  });

  it.each(statuses)('canRetry(%s)', (status) => {
    const result = canRetry(status);
    expect(result).toBe(
      status === 'error' || status === 'network_switch' || status === 'account_changed',
    );
  });

  it('isTerminal(disconnected) is true', () => {
    expect(isTerminal('disconnected')).toBe(true);
  });

  it('isTerminal(connected) is false', () => {
    expect(isTerminal('connected')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// performConnect orchestrator tests
// ---------------------------------------------------------------------------

describe('performConnect — success path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('dispatches CONNECT then CONNECT_SUCCESS on happy path', async () => {
    mockInstalled.mockResolvedValue(true);
    mockConnect.mockResolvedValue('GABCDEF');
    mockCheckNetwork.mockResolvedValue('TESTNET');

    const events: WalletEvent[] = [];
    await performConnect((e) => events.push(e));

    expect(events[0]).toEqual({ type: 'CONNECT' });
    expect(events[1]).toMatchObject({ type: 'CONNECT_SUCCESS', publicKey: 'GABCDEF', network: 'TESTNET' });
  });

  it('results in connected status via reducer', async () => {
    mockInstalled.mockResolvedValue(true);
    mockConnect.mockResolvedValue('GABCDEF');
    mockCheckNetwork.mockResolvedValue('TESTNET');

    const events: WalletEvent[] = [];
    await performConnect((e) => events.push(e));

    const finalState = dispatch(events, INITIAL_STATE);
    expect(finalState.status).toBe('connected');
    expect(finalState.publicKey).toBe('GABCDEF');
  });
});

describe('performConnect — wallet not installed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('dispatches CONNECT then CONNECT_FAILURE with WALLET_NOT_INSTALLED', async () => {
    mockInstalled.mockResolvedValue(false);

    const events: WalletEvent[] = [];
    await performConnect((e) => events.push(e));

    expect(events[0]).toEqual({ type: 'CONNECT' });
    expect(events[1]).toMatchObject({
      type: 'CONNECT_FAILURE',
      errorCode: 'WALLET_NOT_INSTALLED',
    });
    expect((events[1] as any).errorMessage).toMatch(/freighter/i);
  });

  it('results in error status via reducer', async () => {
    mockInstalled.mockResolvedValue(false);

    const events: WalletEvent[] = [];
    await performConnect((e) => events.push(e));

    const finalState = dispatch(events, INITIAL_STATE);
    expect(finalState.status).toBe('error');
    expect(finalState.errorCode).toBe('WALLET_NOT_INSTALLED');
  });
});

describe('performConnect — permission denied', () => {
  beforeEach(() => jest.clearAllMocks());

  it('dispatches CONNECT_FAILURE with WALLET_PERMISSION_DENIED', async () => {
    mockInstalled.mockResolvedValue(true);
    mockConnect.mockRejectedValue(new Error('WALLET_PERMISSION_DENIED'));

    const events: WalletEvent[] = [];
    await performConnect((e) => events.push(e));

    expect(events[1]).toMatchObject({
      type: 'CONNECT_FAILURE',
      errorCode: 'WALLET_PERMISSION_DENIED',
    });
    expect((events[1] as any).errorMessage).toMatch(/permission denied/i);
  });
});

describe('performConnect — wrong network', () => {
  beforeEach(() => jest.clearAllMocks());

  it('dispatches CONNECT_SUCCESS then NETWORK_CHANGED when on PUBLIC', async () => {
    mockInstalled.mockResolvedValue(true);
    mockConnect.mockResolvedValue('GABCDEF');
    mockCheckNetwork.mockResolvedValue('PUBLIC');

    const events: WalletEvent[] = [];
    await performConnect((e) => events.push(e));

    expect(events[1]).toMatchObject({ type: 'CONNECT_SUCCESS', publicKey: 'GABCDEF' });
    expect(events[2]).toMatchObject({ type: 'NETWORK_CHANGED', network: 'PUBLIC' });
  });

  it('results in network_switch status via reducer', async () => {
    mockInstalled.mockResolvedValue(true);
    mockConnect.mockResolvedValue('GABCDEF');
    mockCheckNetwork.mockResolvedValue('PUBLIC');

    const events: WalletEvent[] = [];
    await performConnect((e) => events.push(e));

    const finalState = dispatch(events, INITIAL_STATE);
    expect(finalState.status).toBe('network_switch');
    expect(finalState.errorCode).toBe('WRONG_NETWORK');
  });
});

describe('performConnect — transient / unknown error', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps unknown errors to UNKNOWN code', async () => {
    mockInstalled.mockResolvedValue(true);
    mockConnect.mockRejectedValue(new Error('Network timeout'));

    const events: WalletEvent[] = [];
    await performConnect((e) => events.push(e));

    expect(events[1]).toMatchObject({ type: 'CONNECT_FAILURE', errorCode: 'UNKNOWN' });
  });
});

// ---------------------------------------------------------------------------
// Recovery flows — chained transitions via reducer
// ---------------------------------------------------------------------------

describe('recovery flows', () => {
  it('full happy path: disconnected → connecting → connected', () => {
    const events: WalletEvent[] = [
      { type: 'CONNECT' },
      { type: 'CONNECT_SUCCESS', publicKey: 'GABC', network: 'TESTNET' },
    ];
    const final = dispatch(events);
    expect(final.status).toBe('connected');
  });

  it('error recovery: error → retry → connecting → connected', () => {
    const events: WalletEvent[] = [
      { type: 'CONNECT' },
      { type: 'CONNECT_FAILURE', errorCode: 'UNKNOWN', errorMessage: 'err' },
      { type: 'RETRY' },
      { type: 'CONNECT_SUCCESS', publicKey: 'GABC', network: 'TESTNET' },
    ];
    const final = dispatch(events);
    expect(final.status).toBe('connected');
    expect(final.errorCode).toBeNull();
  });

  it('network switch recovery: connected → network_switch → connected after fix', () => {
    const events: WalletEvent[] = [
      { type: 'CONNECT' },
      { type: 'CONNECT_SUCCESS', publicKey: 'GABC', network: 'TESTNET' },
      { type: 'NETWORK_CHANGED', network: 'PUBLIC' },
      { type: 'NETWORK_CHANGED', network: 'TESTNET' }, // user switched back
    ];
    const final = dispatch(events);
    expect(final.status).toBe('connected');
    expect(final.errorCode).toBeNull();
  });

  it('network switch recovery via retry: network_switch → connecting → connected', () => {
    const events: WalletEvent[] = [
      { type: 'CONNECT' },
      { type: 'CONNECT_SUCCESS', publicKey: 'GABC', network: 'TESTNET' },
      { type: 'NETWORK_CHANGED', network: 'PUBLIC' },
      { type: 'RETRY' },
      { type: 'CONNECT_SUCCESS', publicKey: 'GABC', network: 'TESTNET' },
    ];
    const final = dispatch(events);
    expect(final.status).toBe('connected');
  });

  it('account change recovery: account_changed → retry → connecting → connected', () => {
    const events: WalletEvent[] = [
      { type: 'CONNECT' },
      { type: 'CONNECT_SUCCESS', publicKey: 'GABC', network: 'TESTNET' },
      { type: 'ACCOUNT_CHANGED', publicKey: 'GNEW' },
      { type: 'RETRY' },
      { type: 'CONNECT_SUCCESS', publicKey: 'GNEW', network: 'TESTNET' },
    ];
    const final = dispatch(events);
    expect(final.status).toBe('connected');
    expect(final.publicKey).toBe('GNEW');
  });

  it('disconnect from any state always lands in disconnected', () => {
    const states: ConnectionStatus[] = ['connected', 'error', 'network_switch', 'account_changed', 'connecting'];
    for (const s of states) {
      const base = stateWith({ status: s });
      const next = walletReducer(base, { type: 'DISCONNECT' });
      expect(next.status).toBe('disconnected');
    }
  });

  it('reset from connected clears all fields', () => {
    const connected = stateWith({ status: 'connected', publicKey: 'GABC', network: 'TESTNET', connectedAt: 1000 });
    const next = walletReducer(connected, { type: 'RESET' });
    expect(next).toEqual(INITIAL_STATE);
  });
});

// ---------------------------------------------------------------------------
// performDisconnect
// ---------------------------------------------------------------------------

describe('performDisconnect', () => {
  it('dispatches DISCONNECT event', async () => {
    const events: WalletEvent[] = [];
    await performDisconnect((e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'DISCONNECT' });
  });
});

// ---------------------------------------------------------------------------
// performNetworkCheck
// ---------------------------------------------------------------------------

describe('performNetworkCheck', () => {
  beforeEach(() => jest.clearAllMocks());

  it('dispatches NETWORK_CHANGED with TESTNET when not on wrong network', async () => {
    mockIsWrongNetwork.mockResolvedValue(false);

    const events: WalletEvent[] = [];
    await performNetworkCheck((e) => events.push(e));

    expect(events[0]).toMatchObject({ type: 'NETWORK_CHANGED', network: 'TESTNET' });
  });

  it('dispatches NETWORK_CHANGED with PUBLIC when on wrong network', async () => {
    mockIsWrongNetwork.mockResolvedValue(true);

    const events: WalletEvent[] = [];
    await performNetworkCheck((e) => events.push(e));

    expect(events[0]).toMatchObject({ type: 'NETWORK_CHANGED', network: 'PUBLIC' });
  });

  it('swallows errors silently', async () => {
    mockIsWrongNetwork.mockRejectedValue(new Error('network unreachable'));

    const events: WalletEvent[] = [];
    await expect(performNetworkCheck((e) => events.push(e))).resolves.not.toThrow();
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Error message quality checks
// ---------------------------------------------------------------------------

describe('error messages in state machine', () => {
  it('WRONG_NETWORK error message mentions network or testnet', () => {
    const connected = stateWith({ status: 'connected', publicKey: 'GABC', network: 'TESTNET' });
    const next = walletReducer(connected, { type: 'NETWORK_CHANGED', network: 'PUBLIC' });
    expect(next.errorMessage).toMatch(/network|testnet/i);
  });

  it('account_changed error message is user-readable', () => {
    const connected = stateWith({ status: 'connected', publicKey: 'GABC', network: 'TESTNET' });
    const next = walletReducer(connected, { type: 'ACCOUNT_CHANGED', publicKey: 'GNEW' });
    expect(typeof next.errorMessage).toBe('string');
    expect((next.errorMessage as string).length).toBeGreaterThan(10);
  });
});
