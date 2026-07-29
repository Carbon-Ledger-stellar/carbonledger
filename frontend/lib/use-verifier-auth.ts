"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWalletStatus } from "../hooks/useWalletStatus";
import { getPublicKey } from "./freighter";

interface JWTPayload {
  sub: string;
  role: string;
  exp: number;
}

function parseJwt(token: string): JWTPayload | null {
  try {
    const base64 = token.split(".")[1];
    const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JWTPayload;
  } catch {
    return null;
  }
}

export type VerifierAuthState = "loading" | "authorized" | "redirecting" | "needs_wallet";

export function useVerifierAuth(): {
  state: VerifierAuthState;
  publicKey: string | null;
  token: string | null;
} {
  const router = useRouter();
  const { status: walletStatus, address } = useWalletStatus();
  const [state, setState] = useState<VerifierAuthState>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    if (walletStatus === "loading") {
      setState("loading");
      return;
    }

    if (walletStatus !== "ready") {
      setState("needs_wallet");
      return;
    }

    let cancelled = false;

    (async () => {
      let walletAddress = address;
      if (!walletAddress) {
        try {
          walletAddress = await getPublicKey();
        } catch {
          if (!cancelled) setState("needs_wallet");
          return;
        }
      }

      const jwt = localStorage.getItem("cl_jwt");
      if (!jwt) {
        router.replace("/");
        if (!cancelled) setState("redirecting");
        return;
      }

      const payload = parseJwt(jwt);
      const isVerifierRole = payload?.role === "verifier" || payload?.role === "admin";
      const walletMatches = payload?.sub === walletAddress;

      if (!payload || !isVerifierRole || !walletMatches || Date.now() / 1000 > payload.exp) {
        router.replace("/");
        if (!cancelled) setState("redirecting");
        return;
      }

      if (!cancelled) {
        setPublicKey(walletAddress);
        setToken(jwt);
        setState("authorized");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletStatus, address, router]);

  return { state, publicKey, token };
}
