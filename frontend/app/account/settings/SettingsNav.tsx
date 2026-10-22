"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { colors } from "../../../styles/design-system";

export const SETTINGS_SECTIONS = [
  { href: "/account/settings/profile", label: "Profile" },
  { href: "/account/settings/security", label: "Security" },
  { href: "/account/settings/notifications", label: "Notifications" },
  { href: "/account/settings/api-keys", label: "API keys" },
] as const;

export default function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Account settings sections"
      style={{
        display: "flex",
        gap: "0.25rem",
        overflowX: "auto",
        borderBottom: `1px solid ${colors.neutral[200]}`,
        marginBottom: "1.5rem",
      }}
    >
      {SETTINGS_SECTIONS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            style={{
              padding: "0.75rem 1rem",
              fontSize: "0.9rem",
              fontWeight: active ? 700 : 500,
              whiteSpace: "nowrap",
              textDecoration: "none",
              color: active ? colors.primary[700] : colors.neutral[500],
              borderBottom: `2px solid ${active ? colors.primary[600] : "transparent"}`,
              marginBottom: "-1px",
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}