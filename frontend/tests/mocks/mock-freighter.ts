/**
 * mock-freighter.ts
 *
 * Headless stand-in for the Freighter browser extension, installed into the
 * page before any application code runs via Playwright's `addInitScript`.
 *
 * Why this exists
 * ---------------
 * The wallet checkout flow depends on Freighter, which cannot be installed in a
 * headless CI browser. `@stellar/freighter-api` (v6) does not read methods off
 * `window.freighter`; it posts `FREIGHTER_EXTERNAL_MSG_REQUEST` messages to
 * `window` and waits for a matching `FREIGHTER_EXTERNAL_MSG_RESPONSE` carrying
 * the same `messagedId`. This mock implements that exact responder so the
 * application code runs the same paths it would against the real extension.
 *
 * Protocol (reverse-engineered from the installed `@stellar/freighter-api`
 * 6.0.1 bundle):
 *   request:  window.postMessage({ source: "FREIGHTER_EXTERNAL_MSG_REQUEST",
 *                                   messageId, type, ...payload })
 *   response: window.postMessage({ source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
 *                                   messagedId: messageId, ...result })
 *
 * This file is intentionally self-contained: the function below is serialised
 * by `addInitScript`, so it must not capture any module scope and only use
 * browser globals.
 */

/** Options honoured by the mock. Shape must stay JSON-serialisable. */
export interface MockFreighterOptions {
  /** Stellar public key (StrKey G…) surfaced by getAddress / getPublicKey. */
  publicKey: string;
  /** Network to report from getNetworkDetails (TESTNET by default). */
  network?: 'TESTNET' | 'PUBLIC' | 'FUTURENET';
  /** Network passphrase reported by getNetworkDetails. */
  networkPassphrase?: string;
  /** When true, `setAllowed`/`isAllowed` report permission already granted. */
  isAllowed?: boolean;
  /** When true, SUBMIT_TRANSACTION auto-approves; otherwise it declines. */
  autoApprove?: boolean;
}

/**
 * Self-contained wallet mock, injected with `page.addInitScript`.
 *
 * It installs:
 *   - a `window` message listener answering the Freighter external protocol;
 *   - a `window.freighter` shim (the SDK checks `window.freighter` truthiness
 *     for its `isConnected` fast path) with `getPublicKey`, `signTransaction`,
 *     `isConnected`, `isAllowed`, `setAllowed` and `getNetworkDetails` helpers,
 *     mirroring the surface the wallet-compatibility suite already relies on;
 *   - a `__carbonLedgerWalletMock` marker for assertions.
 */
export function installMockFreighter(opts: MockFreighterOptions): void {
  const publicKey = opts.publicKey;
  const network = opts.network ?? 'TESTNET';
  const networkPassphrase =
    opts.networkPassphrase ??
    'Test SDF Network ; September 2015';
  const isAllowed = opts.isAllowed ?? true;
  const autoApprove = opts.autoApprove ?? true;

  // Freighter's external API carries errors under the `apiError` key.
  const respond = (messageId: unknown, result: Record<string, unknown>): void => {
    window.postMessage(
      {
        source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
        messagedId: messageId,
        ...result,
      },
      window.location.origin,
    );
  };

  const networkDetails = {
    network,
    networkName: network,
    networkUrl:
      network === 'PUBLIC'
        ? 'https://horizon.stellar.org'
        : 'https://horizon-testnet.stellar.org',
    networkPassphrase,
    sorobanRpcUrl:
      network === 'PUBLIC'
        ? 'https://soroban.stellar.org'
        : 'https://soroban-testnet.stellar.org',
  };

  window.addEventListener('message', (event: MessageEvent) => {
    const data = (event && event.data) as Record<string, unknown> | undefined;
    if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;

    // The SDK generates `messageId` as `Date.now() + Math.random()` (a number)
    // and matches the response with strict equality, so it must be echoed back
    // with its original type rather than coerced to a string.
    const messageId = data.messageId;
    const type = String(data.type);

    switch (type) {
      case 'REQUEST_ACCESS':
      case 'REQUEST_PUBLIC_KEY':
        respond(messageId, { publicKey });
        break;

      case 'REQUEST_CONNECTION_STATUS':
        respond(messageId, { isConnected: true });
        break;

      case 'REQUEST_ALLOWED_STATUS':
        respond(messageId, { isAllowed });
        break;

      case 'SET_ALLOWED_STATUS':
        respond(messageId, { isAllowed: true });
        break;

      // NOTE: `getNetwork` (flat) and `getNetworkDetails` (nested) use
      // different response shapes in the 6.0.1 SDK.
      case 'REQUEST_NETWORK':
        respond(messageId, { network, networkPassphrase });
        break;

      case 'REQUEST_NETWORK_DETAILS':
        respond(messageId, { networkDetails });
        break;

      case 'SUBMIT_TRANSACTION': {
        if (!autoApprove) {
          respond(messageId, {
            signedTransaction: '',
            signerAddress: '',
            apiError: {
              code: -4,
              message: 'User declined the transaction',
            },
          });
          break;
        }

        // Auto-approve with a simulated keypair. The signed XDR is opaque to the
        // app for the purchase path (the backend signs server-side), so a
        // deterministic marker derived from the input is sufficient to prove the
        // signing hook fired.
        const transactionXdr = String(data.transactionXdr ?? '');
        const signedTransaction =
          `${transactionXdr}.mock-sig.${publicKey.slice(0, 8)}`.slice(0, 240);
        respond(messageId, { signedTransaction, signerAddress: publicKey });
        break;
      }

      case 'SUBMIT_BLOB': {
        const blob = String(data.blob ?? '');
        respond(messageId, {
          signedBlob: `${blob}.mock-sig`,
          signerAddress: publicKey,
        });
        break;
      }

      case 'SUBMIT_AUTH_ENTRY': {
        respond(messageId, {
          signedAuthEntry: `${String(data.entryXdr ?? '')}.mock-sig`,
          signerAddress: publicKey,
        });
        break;
      }

      default:
        // Unknown extension message — the SDK treats a non-matching/no reply as
        // an error, so reply with a generic internal error to avoid hanging.
        respond(messageId, {
          apiError: { code: -1, message: 'Unsupported request type' },
        });
        break;
    }
  });

  // The SDK's `isConnected` fast path checks `window.freighter` truthiness.
  const freighterShim = {
    getPublicKey: () => Promise.resolve({ publicKey, error: null }),
    signTransaction: (xdr: string) =>
      Promise.resolve({
        signedTxXdr: autoApprove ? `${xdr}.mock-sig` : '',
        error: autoApprove ? null : { code: -4, message: 'declined' },
      }),
    isConnected: () => Promise.resolve({ isConnected: true }),
    isAllowed: () => Promise.resolve({ isAllowed }),
    setAllowed: () => Promise.resolve({ isAllowed: true }),
    getNetworkDetails: () =>
      Promise.resolve({
        network,
        networkPassphrase,
        error: null,
      }),
  };

  (window as unknown as Record<string, unknown>).freighter = freighterShim;
  (window as unknown as Record<string, unknown>).__carbonLedgerWalletMock = {
    name: 'Freighter',
    version: '6.0.1',
    publicKey,
    network,
    autoApprove,
  };
}
