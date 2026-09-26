export interface MockWalletProviderOptions {
  publicKey: string;
  network?: 'TESTNET' | 'PUBLIC' | 'FUTURENET';
  autoApprove?: boolean;
}

/**
 * Installs a deterministic Stellar wallet before the application loads.
 * The Freighter message listener is included because the production wallet
 * adapter talks to the extension through that protocol.
 */
export function installMockWalletProvider(
  options: MockWalletProviderOptions,
): void {
  const publicKey = options.publicKey;
  const network = options.network ?? 'TESTNET';
  const autoApprove = options.autoApprove ?? true;
  const networkPassphrase =
    network === 'PUBLIC'
      ? 'Public Global Stellar Network ; September 2015'
      : 'Test SDF Network ; September 2015';

  const sign = (xdr: string) =>
    autoApprove
      ? { signedTxXdr: `${xdr}.mock-signed`, error: null }
      : { signedTxXdr: '', error: { code: -4, message: 'User declined the transaction' } };

  const stellar = {
    isConnected: () => Promise.resolve(true),
    isAllowed: () => Promise.resolve(true),
    getPublicKey: () => Promise.resolve(publicKey),
    getAddress: () => Promise.resolve(publicKey),
    getNetwork: () => Promise.resolve(network),
    getNetworkDetails: () =>
      Promise.resolve({ network, networkPassphrase, error: null }),
    signTransaction: (xdr: string) => Promise.resolve(sign(xdr)),
  };

  const respond = (messageId: unknown, result: Record<string, unknown>) => {
    window.postMessage(
      {
        source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
        messagedId: messageId,
        ...result,
      },
      window.location.origin,
    );
  };

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | undefined;
    if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;

    const messageId = data.messageId;
    switch (String(data.type)) {
      case 'REQUEST_ACCESS':
      case 'REQUEST_PUBLIC_KEY':
        respond(messageId, { publicKey });
        break;
      case 'REQUEST_CONNECTION_STATUS':
        respond(messageId, { isConnected: true });
        break;
      case 'REQUEST_ALLOWED_STATUS':
      case 'SET_ALLOWED_STATUS':
        respond(messageId, { isAllowed: true });
        break;
      case 'REQUEST_NETWORK':
        respond(messageId, { network, networkPassphrase });
        break;
      case 'REQUEST_NETWORK_DETAILS':
        respond(messageId, {
          networkDetails: { network, networkPassphrase },
        });
        break;
      case 'SUBMIT_TRANSACTION': {
        const result = sign(String(data.transactionXdr ?? ''));
        respond(messageId, {
          signedTransaction: result.signedTxXdr,
          signerAddress: publicKey,
          ...(result.error ? { apiError: result.error } : {}),
        });
        break;
      }
      default:
        respond(messageId, {
          apiError: { code: -1, message: 'Unsupported wallet request' },
        });
    }
  });

  const windowRecord = window as unknown as Record<string, unknown>;
  windowRecord.stellar = stellar;
  windowRecord.freighter = stellar;
  windowRecord.__carbonLedgerWalletMock = {
    publicKey,
    network,
    autoApprove,
  };
}