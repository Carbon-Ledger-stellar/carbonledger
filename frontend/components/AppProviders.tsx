"use client";

import { WalletProvider } from "@/lib/wallet/WalletContext";
import { ContractProvider } from "@/lib/contract-context";
import KeyboardShortcutsProvider from "./KeyboardShortcutsProvider";

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <ContractProvider>
        <KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>
      </ContractProvider>
    </WalletProvider>
  );
}
