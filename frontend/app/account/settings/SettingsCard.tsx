import { colors } from "../../../styles/design-system";

export default function SettingsCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: colors.surface,
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: "0.75rem",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "1.25rem 1.5rem", borderBottom: `1px solid ${colors.neutral[100]}` }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, color: colors.neutral[900], margin: 0 }}>{title}</h2>
      </div>
      <div style={{ padding: "1.25rem 1.5rem" }}>{children}</div>
    </section>
  );
}