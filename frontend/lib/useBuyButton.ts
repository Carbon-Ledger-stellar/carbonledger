"use client";

import { useState, useRef, useCallback } from "react";

export type BuyButtonState = "idle" | "loading" | "success" | "error";

export function useBuyButton() {
  const [state, setState] = useState<BuyButtonState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  // Raw error from the last failure, so callers can map it to an actionable
  // message (see lib/purchase-errors.ts) rather than only the error string.
  const [error, setError] = useState<unknown>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setError(null);
    setState("loading");
    try {
      await action();
      setState("success");
      timerRef.current = setTimeout(reset, 3000);
    } catch (e: any) {
      setError(e);
      setErrorMsg(e?.message ?? "Something went wrong");
      setState("error");
      timerRef.current = setTimeout(reset, 5000);
    }
  }, [reset]);

  return { state, errorMsg, error, run };
}
