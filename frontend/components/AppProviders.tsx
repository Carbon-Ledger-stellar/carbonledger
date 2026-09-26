"use client";

import { WalletProvider } from "@/lib/wallet/WalletContext";
import KeyboardShortcutsProvider from "./KeyboardShortcutsProvider";

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>
    </WalletProvider>
  );
}
