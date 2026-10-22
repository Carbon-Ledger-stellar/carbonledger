"use client";

import SettingsCard from "../SettingsCard";
import { usePublicKey } from "../usePublicKey";
import { colors } from "../../../../styles/design-system";

export default function ProfileSettingsPage() {
  const publicKey = usePublicKey();

  return (
    <SettingsCard title="Profile">
      <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: colors.neutral[500] }}>
        Your account is identified by the wallet public key below. Editable profile details are not available yet.
      </p>
      <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: colors.neutral[700] }}>Wallet public key</p>
      <p style={{ margin: "0.25rem 0 0", fontFamily: "monospace", fontSize: "0.85rem", wordBreak: "break-all", color: colors.neutral[900] }}>
        {publicKey || "No wallet connected."}
      </p>
    </SettingsCard>
  );
}