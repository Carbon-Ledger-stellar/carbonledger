jest.mock('@stellar/freighter-api', () => ({
  isConnected: jest.fn(),
  isAllowed: jest.fn(),
  setAllowed: jest.fn(),
  getAddress: jest.fn(),
  signTransaction: jest.fn(),
  getNetworkDetails: jest.fn(),
  WatchWalletChanges: class {},
}));

import { getAddress } from '@stellar/freighter-api';
import { getPublicKey } from '../lib/freighter';
import {
  detectBrowser,
  getBrowserInstallUrl,
  isBrowserUnsupported,
} from '../lib/browser-install-links';

const mockGetAddress = getAddress as jest.MockedFunction<typeof getAddress>;

describe('getPublicKey — locked wallet detection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws WALLET_LOCKED when Freighter reports the wallet is locked', async () => {
    mockGetAddress.mockResolvedValue({ address: '', error: 'Freighter is locked, and needs to be unlocked' } as any);
    await expect(getPublicKey()).rejects.toThrow('WALLET_LOCKED');
  });

  it('passes through other errors verbatim', async () => {
    mockGetAddress.mockResolvedValue({ address: '', error: 'User declined access' } as any);
    await expect(getPublicKey()).rejects.toThrow('User declined access');
  });

  it('resolves the address on success', async () => {
    mockGetAddress.mockResolvedValue({ address: 'GABC', error: undefined } as any);
    await expect(getPublicKey()).resolves.toBe('GABC');
  });
});

describe('browser detection for install links', () => {
  const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0';
  const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0';

  it('detects Chrome and links to the Chrome Web Store', () => {
    const browser = detectBrowser(CHROME_UA);
    expect(browser).toBe('chrome');
    expect(getBrowserInstallUrl(browser)).toContain('chromewebstore.google.com');
  });

  it('detects Firefox and links to Firefox Add-ons', () => {
    const browser = detectBrowser(FIREFOX_UA);
    expect(browser).toBe('firefox');
    expect(getBrowserInstallUrl(browser)).toContain('addons.mozilla.org');
  });

  it('detects Edge separately from Chrome but still points to the Chrome Web Store', () => {
    const browser = detectBrowser(EDGE_UA);
    expect(browser).toBe('edge');
    expect(getBrowserInstallUrl(browser)).toContain('chromewebstore.google.com');
  });

  it('flags Safari as unsupported (no Freighter extension) and falls back to freighter.app', () => {
    const browser = detectBrowser(SAFARI_UA);
    expect(browser).toBe('safari');
    expect(isBrowserUnsupported(browser)).toBe(true);
    expect(getBrowserInstallUrl(browser)).toContain('freighter.app');
  });
});
