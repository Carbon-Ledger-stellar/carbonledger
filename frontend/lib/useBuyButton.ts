"use client";

import { useState, useRef, useCallback } from "react";

export type BuyButtonState = "idle" | "loading" | "success" | "error";

export function useBuyButton() {
  const [state, setState] = useState<BuyButtonState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => setState("idle"), []);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState("loading");
    try {
      await action();
      setState("success");
      timerRef.current = setTimeout(reset, 3000);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Something went wrong");
      setState("error");
      timerRef.current = setTimeout(reset, 5000);
    }
  }, [reset]);

  return { state, errorMsg, run };
}
