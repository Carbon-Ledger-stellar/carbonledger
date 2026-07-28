"use client";

import { WalletProvider } from "@/lib/wallet/WalletContext";

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
