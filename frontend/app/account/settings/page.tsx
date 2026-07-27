"use client";

import { useState } from "react";
import { useNotificationPreferences, updateNotificationPreferences, NotificationPreferences } from "../../../lib/api";
import { colors } from "../../../styles/design-system";

const PREFERENCE_LABELS: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  { key: "projectApproved",    label: "Project Approved",    description: "When your carbon project is verified and approved." },
  { key: "creditsMinted",      label: "Credits Minted",      description: "When new credit batches are minted for your project." },
  { key: "purchaseConfirmed",  label: "Purchase Confirmed",  description: "When you successfully purchase credits from the marketplace." },
  { key: "retirementConfirmed", label: "Retirement Confirmed", description: "When credits are permanently retired on-chain." },
];

export default function AccountSettingsPage() {
  // In production this comes from the auth context / JWT
  const publicKey = typeof window !== "undefined" ? (localStorage.getItem("publicKey") ?? "") : "";

  const { data: prefs, mutate } = useNotificationPreferences(publicKey);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function toggle(key: keyof NotificationPreferences) {
    if (!prefs) return;
    const updated = { ...prefs, [key]: !prefs[key] };
    mutate(updated, false);
    setSaving(true);
    setSaved(false);
    try {
      await updateNotificationPreferences(publicKey, { [key]: !prefs[key] });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.5rem" }}>
        Account Settings
      </h1>
      <p style={{ color: colors.neutral[500], margin: "0 0 2rem", fontSize: "0.9rem" }}>
        Manage which events send you email notifications.
      </p>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: "0.75rem",
        overflow: "hidden",
      }}>
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: `1px solid ${colors.neutral[100]}` }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>
            Email Notification Preferences
          </h2>
        </div>

        {!prefs ? (
          <div style={{ padding: "2rem 1.5rem", color: colors.neutral[400], fontSize: "0.875rem" }}>
            {publicKey ? "Loading preferences…" : "Connect your wallet to manage preferences."}
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {PREFERENCE_LABELS.map(({ key, label, description }, i) => (
              <li
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "1rem 1.5rem",
                  borderTop: i === 0 ? "none" : `1px solid ${colors.neutral[100]}`,
                }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: "0.9rem", color: colors.neutral[900] }}>{label}</p>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.8rem", color: colors.neutral[500] }}>{description}</p>
                </div>
                <button
                  onClick={() => toggle(key)}
                  disabled={saving}
                  aria-label={`${prefs[key] ? "Disable" : "Enable"} ${label} notifications`}
                  style={{
                    width: "44px",
                    height: "24px",
                    borderRadius: "9999px",
                    border: "none",
                    cursor: saving ? "not-allowed" : "pointer",
                    background: prefs[key] ? colors.primary[600] : colors.neutral[300],
                    position: "relative",
                    transition: "background 0.2s",
                    flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: "absolute",
                    top: "3px",
                    left: prefs[key] ? "23px" : "3px",
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    background: "#fff",
                    transition: "left 0.2s",
                  }} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {saved && (
          <div style={{
            padding: "0.75rem 1.5rem",
            background: "#F0FDF4",
            borderTop: `1px solid ${colors.neutral[100]}`,
            fontSize: "0.8rem",
            color: "#166534",
          }}>
            ✓ Preferences saved
          </div>
        )}
      </div>
    </div>
  );
}
