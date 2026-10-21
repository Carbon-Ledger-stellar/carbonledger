import { useEffect, useRef, useState } from 'react';

type NetworkState = 'online' | 'offline' | 'degraded';

interface NetworkStatusIndicatorProps {
  /**
   * Lightweight health endpoint used to detect Horizon/Soroban RPC outages.
   * Defaults to the Horizon root endpoint, which returns quickly when healthy.
   */
  healthEndpoint?: string;
  /**
   * How often (in milliseconds) to re-check RPC health while the browser is online.
   */
  checkInterval?: number;
}

const DEFAULT_HEALTH_ENDPOINT = 'https://horizon.stellar.org/';
const DEFAULT_CHECK_INTERVAL = 30000;

export default function NetworkStatusIndicator({
  healthEndpoint = DEFAULT_HEALTH_ENDPOINT,
  checkInterval = DEFAULT_CHECK_INTERVAL,
}: NetworkStatusIndicatorProps = {}) {
  const [browserOnline, setBrowserOnline] = useState<boolean>(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [rpcReachable, setRpcReachable] = useState<boolean>(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!browserOnline) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const checkHealth = async () => {
      try {
        const response = await fetch(healthEndpoint, {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!cancelled && mountedRef.current) {
          setRpcReachable(response.ok);
        }
      } catch (error) {
        if (!cancelled && mountedRef.current) {
          setRpcReachable(false);
        }
      }
    };

    void checkHealth();
    const intervalId = window.setInterval(checkHealth, checkInterval);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [browserOnline, healthEndpoint, checkInterval]);

  const state: NetworkState = !browserOnline
    ? 'offline'
    : rpcReachable
      ? 'online'
      : 'degraded';

  const config: Record<NetworkState, { label: string; color: string; dot: string }> = {
    online: { label: 'Online', color: 'text-green-600', dot: 'bg-green-500' },
    offline: { label: 'Offline', color: 'text-red-600', dot: 'bg-red-500' },
    degraded: { label: 'Degraded', color: 'text-yellow-600', dot: 'bg-yellow-500' },
  };

  const { label, color, dot } = config[state];

  return (
    <div
      className={`flex items-center gap-2 text-sm font-medium ${color}`}
      role="status"
      aria-live="polite"
      title={
        state === 'degraded'
          ? 'Browser is online but the Stellar network RPC is unreachable'
          : undefined
      }
    >
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
