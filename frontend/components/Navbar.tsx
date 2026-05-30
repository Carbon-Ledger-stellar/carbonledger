'use client';

import { useWallet } from '@/lib/wallet/WalletContext';
import { useEffect, useState } from 'react';

export default function Navbar() {
  const { isConnected, publicKey, error, connect, disconnect, checkNetwork } = useWallet();
  const [networkWarning, setNetworkWarning] = useState<string | null>(null);

  useEffect(() => {
    if (isConnected) {
      checkNetwork().then(({ isCorrect, currentNetwork }) => {
        if (!isCorrect) {
          setNetworkWarning(`Network mismatch: ${currentNetwork}`);
        } else {
          setNetworkWarning(null);
        }
      });
    }
  }, [isConnected, checkNetwork]);

  const handleConnect = async () => {
    const result = await connect();
    if (!result.success && result.error?.includes('not installed')) {
      if (confirm('Freighter wallet not installed. Install now?')) {
        window.open('https://freighter.app/', '_blank');
      }
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
  };

  const truncateAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <nav style={styles.nav}>
      <div style={styles.logo}>
        <a href="/" style={styles.logoLink}>CarbonLedger</a>
      </div>
      
      <div style={styles.right}>
        {error && <span style={styles.error}>{error}</span>}
        
        {networkWarning && (
          <span style={styles.warning}>{networkWarning}</span>
        )}
        
        {isConnected && publicKey ? (
          <div style={styles.walletInfo}>
            <span style={styles.address}>{truncateAddress(publicKey)}</span>
            <button onClick={handleDisconnect} style={styles.disconnectBtn}>
              Disconnect
            </button>
          </div>
        ) : (
          <button onClick={handleConnect} style={styles.connectBtn}>
            Connect Wallet
          </button>
        )}
      </div>
    </nav>
  );
}

const styles = {
  nav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 2rem',
    backgroundColor: '#1a1a2e',
    color: '#fff',
    flexWrap: 'wrap' as const,
  },
  logoLink: {
    fontSize: '1.5rem',
    fontWeight: 'bold' as const,
    color: '#fff',
    textDecoration: 'none',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flexWrap: 'wrap' as const,
  },
  connectBtn: {
    padding: '0.5rem 1rem',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  disconnectBtn: {
    padding: '0.5rem 1rem',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  walletInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  address: {
    padding: '0.5rem 1rem',
    backgroundColor: '#16213e',
    borderRadius: '4px',
    fontFamily: 'monospace',
  },
  error: {
    color: '#ff6b6b',
    fontSize: '0.875rem',
  },
  warning: {
    color: '#ffc107',
    fontSize: '0.875rem',
  },
};