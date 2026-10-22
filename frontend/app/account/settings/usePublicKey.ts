"use client";

import { useEffect, useState } from "react";

/** Connected wallet public key from localStorage ("" until mounted or if none). */
export function usePublicKey(): string {
  const [publicKey, setPublicKey] = useState("");
  useEffect(() => {
    setPublicKey(localStorage.getItem("publicKey") ?? "");
  }, []);
  return publicKey;
}