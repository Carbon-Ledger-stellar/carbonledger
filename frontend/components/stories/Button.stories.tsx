import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../Button";

const meta: Meta<typeof Button> = {
  title: "Design System/Button",
  component: Button,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
**Button** is the primary interactive control across CarbonLedger.

### Hierarchy
Use \`variant\` to express visual weight:

| Variant | When to use |
|---------|-------------|
| \`primary\` | The single most important action on the page (Buy, Retire, Connect Wallet). Use at most one per screen section. |
| \`secondary\` | Supporting actions of moderate importance (View details, Download PDF). Can appear alongside a primary. |
| \`tertiary\` | Low-emphasis actions (Cancel, Skip, Clear filters). Never competes with primary/secondary. |

### Sizes
\`sm\` for compact UI (table rows, filter bars), \`md\` for standard use, \`lg\` for high-visibility CTAs.
        `,
      },
    },
  },
  argTypes: {
    variant:  { control: "radio",   options: ["primary", "secondary", "tertiary"] },
    size:     { control: "radio",   options: ["sm", "md", "lg"] },
    loading:  { control: "boolean" },
    disabled: { control: "boolean" },
    fullWidth:{ control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Primary ──────────────────────────────────────────────────────────────────

export const Primary: Story = {
  args: { variant: "primary", children: "Buy credits" },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "View details" },
};

export const Tertiary: Story = {
  args: { variant: "tertiary", children: "Skip setup" },
};

// ── Sizes ────────────────────────────────────────────────────────────────────

export const SmallSize: Story = {
  args: { variant: "primary", size: "sm", children: "Filter" },
};

export const LargeSize: Story = {
  args: { variant: "primary", size: "lg", children: "Connect Wallet" },
};

// ── States ───────────────────────────────────────────────────────────────────

export const Loading: Story = {
  args: { variant: "primary", loading: true, children: "Processing…" },
};

export const Disabled: Story = {
  args: { variant: "primary", disabled: true, children: "Unavailable" },
};

export const FullWidth: Story = {
  args: { variant: "primary", fullWidth: true, children: "Retire credits" },
  parameters: { layout: "padded" },
};

// ── With icons ───────────────────────────────────────────────────────────────

export const WithLeadingIcon: Story = {
  args: { variant: "primary", leadingIcon: "🌱", children: "Mint credits" },
};

export const WithTrailingIcon: Story = {
  args: { variant: "secondary", trailingIcon: "↗", children: "Export PDF" },
};

// ── Hierarchy showcase ───────────────────────────────────────────────────────

export const HierarchyShowcase: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <section>
        <p style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#6b7280", marginBottom: "0.75rem" }}>
          All variants — medium (default)
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="tertiary">Tertiary</Button>
        </div>
      </section>

      <section>
        <p style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#6b7280", marginBottom: "0.75rem" }}>
          All sizes — primary
        </p>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </section>

      <section>
        <p style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#6b7280", marginBottom: "0.75rem" }}>
          Disabled state
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Button variant="primary"   disabled>Primary</Button>
          <Button variant="secondary" disabled>Secondary</Button>
          <Button variant="tertiary"  disabled>Tertiary</Button>
        </div>
      </section>

      <section>
        <p style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#6b7280", marginBottom: "0.75rem" }}>
          Loading state
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Button variant="primary"   loading>Minting…</Button>
          <Button variant="secondary" loading>Exporting…</Button>
        </div>
      </section>

      <section>
        <p style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#6b7280", marginBottom: "0.75rem" }}>
          Typical page action group
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Button variant="primary">Retire credits</Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="tertiary">Cancel</Button>
        </div>
      </section>
    </div>
  ),
};
