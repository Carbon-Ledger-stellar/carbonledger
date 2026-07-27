export interface WalletState {
  isConnected: boolean;
  publicKey: string | null;
  network: string | null;
  error: string | null;
}

class FreighterWallet {
  private static instance: FreighterWallet;
  private state: WalletState = {
    isConnected: false,
    publicKey: null,
    network: null,
    error: null,
  };
  private listeners: ((state: WalletState) => void)[] = [];

  private constructor() {
    this.loadFromStorage();
  }

  static getInstance(): FreighterWallet {
    if (!FreighterWallet.instance) {
      FreighterWallet.instance = new FreighterWallet();
    }
    return FreighterWallet.instance;
  }

  private loadFromStorage() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('freighter_wallet');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          this.state = { ...this.state, ...parsed };
        } catch (e) {
          console.error('Failed to load wallet from storage', e);
        }
      }
    }
  }

  private saveToStorage() {
    if (typeof window !== 'undefined') {
      localStorage.setItem('freighter_wallet', JSON.stringify({
        publicKey: this.state.publicKey,
        network: this.state.network,
        isConnected: this.state.isConnected,
      }));
    }
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener({ ...this.state }));
  }

  subscribe(listener: (state: WalletState) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  getState(): WalletState {
    return { ...this.state };
  }

  async connect(): Promise<{ success: boolean; error?: string }> {
    try {
      const isInstalled = (window as any).freighterApi?.isConnected;
      
      if (!isInstalled && typeof (window as any).freighterApi === 'undefined') {
        this.state.error = 'Freighter not installed. Please install Freighter wallet extension.';
        this.notifyListeners();
        return { 
          success: false, 
          error: 'Freighter not installed. Please install the Freighter wallet extension.' 
        };
      }

      const publicKey = await (window as any).freighterApi.getPublicKey();
      const network = await (window as any).freighterApi.getNetwork();
      
      this.state = {
        isConnected: true,
        publicKey: publicKey,
        network: network,
        error: null,
      };
      
      this.saveToStorage();
      this.notifyListeners();
      
      return { success: true };
    } catch (error: any) {
      this.state.error = error.message;
      this.notifyListeners();
      return { success: false, error: error.message };
    }
  }

  async disconnect(): Promise<void> {
    this.state = {
      isConnected: false,
      publicKey: null,
      network: null,
      error: null,
    };
    localStorage.removeItem('freighter_wallet');
    this.notifyListeners();
  }

  async checkNetwork(): Promise<{ isCorrect: boolean; currentNetwork: string | null }> {
    if (!this.state.isConnected || !this.state.network) {
      return { isCorrect: false, currentNetwork: null };
    }
    
    const expectedNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet';
    const isCorrect = this.state.network === expectedNetwork;
    
    if (!isCorrect) {
      this.state.error = `Network mismatch. Expected ${expectedNetwork}, got ${this.state.network}`;
      this.notifyListeners();
    }
    
    return { isCorrect, currentNetwork: this.state.network };
  }

  async signTransaction(xdr: string): Promise<string | null> {
    if (!this.state.isConnected) {
      this.state.error = 'Wallet not connected';
      this.notifyListeners();
      return null;
    }
    
    try {
      const signedXDR = await (window as any).freighterApi.signTransaction(xdr, {
        networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
      });
      return signedXDR;
    } catch (error: any) {
      this.state.error = error.message;
      this.notifyListeners();
      return null;
    }
  }
}

export const freighterWallet = FreighterWallet.getInstance();