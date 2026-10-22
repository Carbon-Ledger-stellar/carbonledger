import SettingsNav from "./SettingsNav";
import { colors } from "../../../styles/design-system";

export const dynamic = "force-dynamic";

export default function AccountSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 1.5rem" }}>
        Account Settings
      </h1>
      <SettingsNav />
      {children}
    </div>
  );
}