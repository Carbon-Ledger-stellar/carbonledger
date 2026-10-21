import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';

interface UseAdminRoleResult {
  isAdmin: boolean;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Determines whether the currently authenticated user has an admin role.
 * Used to gate admin-only controls such as the pause control panel.
 */
export function useAdminRole(): UseAdminRoleResult {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRole = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.getCurrentUser();
      const role = response?.data?.role ?? response?.role;
      setIsAdmin(role === 'admin');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to determine admin role.'
      );
      setIsAdmin(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRole();
  }, [fetchRole]);

  return { isAdmin, isLoading, error, refetch: fetchRole };
}

export default useAdminRole;
