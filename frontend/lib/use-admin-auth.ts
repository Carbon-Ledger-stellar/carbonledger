'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface JWTPayload {
  sub:   string;
  role:  string;
  email: string;
  iat:   number;
  exp:   number;
}

function parseJwt(token: string): JWTPayload | null {
  try {
    const base64 = token.split('.')[1];
    const json   = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as JWTPayload;
  } catch {
    return null;
  }
}

export type AuthState = 'loading' | 'authorized' | 'unauthorized';

export function useAdminAuth(): { state: AuthState; email: string | null } {
  const router            = useRouter();
  const [state, setState] = useState<AuthState>('loading');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('cl_jwt');

    if (!token) {
      router.replace('/login?reason=admin_required');
      setState('unauthorized');
      return;
    }

    const payload = parseJwt(token);

    if (!payload || payload.role !== 'admin') {
      router.replace('/login?reason=admin_required');
      setState('unauthorized');
      return;
    }

    if (Date.now() / 1000 > payload.exp) {
      localStorage.removeItem('cl_jwt');
      router.replace('/login?reason=session_expired');
      setState('unauthorized');
      return;
    }

    setEmail(payload.email);
    setState('authorized');
  }, [router]);

  return { state, email };
}
