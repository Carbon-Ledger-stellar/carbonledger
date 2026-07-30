import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import WalletPrompt from '../WalletPrompt';
import type { WalletStatus } from '../../hooks/useWalletStatus';

jest.mock('next-intl');

jest.mock('../../lib/freighter', () => ({
  connectFreighter: jest.fn(),
  checkNetwork: jest.fn(),
}));

jest.mock('../../lib/browser-install-links', () => ({
  getCurrentBrowserInstallUrl: jest.fn(() => 'https://chromewebstore.google.com/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk'),
}));

import { connectFreighter, checkNetwork } from '../../lib/freighter';

const mockConnect = connectFreighter as jest.MockedFunction<typeof connectFreighter>;
const mockCheckNetwork = checkNetwork as jest.MockedFunction<typeof checkNetwork>;

function setup(status: WalletStatus) {
  const onConnect = jest.fn();
  const refresh = jest.fn();
  render(<WalletPrompt status={status} onConnect={onConnect} refresh={refresh} />);
  return { onConnect, refresh };
}

describe('WalletPrompt — five connection failure modes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing while loading', () => {
    const { container } = render(<WalletPrompt status="loading" onConnect={jest.fn()} refresh={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when ready (connected)', () => {
    const { container } = render(<WalletPrompt status="ready" onConnect={jest.fn()} refresh={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('extension not installed: shows install prompt with a browser-specific install link', async () => {
    setup('not_installed');

    expect(screen.getByText('Wallet Required')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Install Freighter' });

    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(button);

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('chromewebstore.google.com'),
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });

  it('extension locked: shows an unlock prompt distinct from "not installed"', () => {
    setup('locked');

    expect(screen.getByText('Wallet Locked')).toBeInTheDocument();
    expect(screen.getByText(/unlock it/i)).toBeInTheDocument();
    expect(screen.queryByText('Wallet Required')).not.toBeInTheDocument();
  });

  it('not connected: connect button invokes connectFreighter and reports the new address', async () => {
    mockConnect.mockResolvedValue('GABC123');
    const { onConnect, refresh } = setup('not_connected');

    fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('GABC123'));
    expect(refresh).toHaveBeenCalled();
  });

  it('not connected: surfaces a specific actionable error (not a generic failure) when connect rejects', async () => {
    mockConnect.mockRejectedValue(new Error('WALLET_PERMISSION_DENIED'));
    const { onConnect } = setup('not_connected');

    fireEvent.click(screen.getByRole('button', { name: 'Connect Wallet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i);
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('network mismatch: shows the detected network name and a switch/continue action', async () => {
    mockCheckNetwork.mockResolvedValue('PUBLIC');
    const { refresh } = setup('wrong_network');

    expect(await screen.findByText(/Mainnet \(Public\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: "I've Switched — Continue" }));
    expect(refresh).toHaveBeenCalled();
  });

  it('session expiry mid-flow: shows a reconnect prompt distinct from the initial connect prompt', () => {
    setup('session_expired');

    expect(screen.getByText('Session Expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect Wallet' })).toBeInTheDocument();
    expect(screen.queryByText('Connect Your Wallet')).not.toBeInTheDocument();
  });

  it('every failure mode renders a distinct, non-generic title', () => {
    const statuses: WalletStatus[] = ['not_installed', 'locked', 'not_connected', 'wrong_network', 'session_expired'];
    const titles = new Set<string>();

    statuses.forEach((status) => {
      const { unmount } = render(<WalletPrompt status={status} onConnect={jest.fn()} refresh={jest.fn()} />);
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading.textContent).not.toMatch(/^connection failed$/i);
      titles.add(heading.textContent ?? '');
      unmount();
    });

    expect(titles.size).toBe(statuses.length);
  });
});
