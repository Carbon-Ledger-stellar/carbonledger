"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { colors, borderRadius, spacing, typography } from "../styles/design-system";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "tertiary";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual hierarchy:
   * - `primary`   — filled green, the single most important action on a page.
   * - `secondary` — outlined, supporting actions of moderate importance.
   * - `tertiary`  — ghost/text, low-emphasis actions such as Cancel or Skip.
   */
  variant?: ButtonVariant;
  /** Size of the button. Defaults to `md`. */
  size?: ButtonSize;
  /** Renders a loading spinner and disables interaction. */
  loading?: boolean;
  /** Icon rendered before the label. */
  leadingIcon?: React.ReactNode;
  /** Icon rendered after the label. */
  trailingIcon?: React.ReactNode;
  /** Stretch to fill its container. */
  fullWidth?: boolean;
}

// ─── Style helpers ────────────────────────────────────────────────────────────

type SizeTokens = {
  paddingV: string;
  paddingH: string;
  fontSize: string;
  height: string;
};

const SIZE_TOKENS: Record<ButtonSize, SizeTokens> = {
  sm: { paddingV: spacing[2],  paddingH: spacing[3],  fontSize: typography.fontSize.sm,   height: "2rem"    },
  md: { paddingV: spacing[2],  paddingH: spacing[4],  fontSize: typography.fontSize.base,  height: "2.5rem"  },
  lg: { paddingV: spacing[3],  paddingH: spacing[5],  fontSize: typography.fontSize.lg,   height: "3rem"    },
};

function buildStyle(
  variant: ButtonVariant,
  size: ButtonSize,
  disabled: boolean,
  fullWidth: boolean,
): React.CSSProperties {
  const { paddingV, paddingH, fontSize, height } = SIZE_TOKENS[size];

  const base: React.CSSProperties = {
    display:        "inline-flex",
    alignItems:     "center",
    justifyContent: "center",
    gap:            spacing[2],
    height,
    padding:        `${paddingV} ${paddingH}`,
    fontSize,
    fontFamily:     typography.fontFamily.sans,
    fontWeight:     typography.fontWeight.semibold,
    lineHeight:     typography.lineHeight.tight,
    borderRadius:   borderRadius.lg,
    border:         "1px solid transparent",
    cursor:         disabled ? "not-allowed" : "pointer",
    opacity:        disabled ? 0.5 : 1,
    textDecoration: "none",
    whiteSpace:     "nowrap",
    width:          fullWidth ? "100%" : undefined,
    transition:     "background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s",
  };

  if (variant === "primary") {
    return {
      ...base,
      background:  disabled ? colors.neutral[300] : colors.primary[600],
      color:       disabled ? colors.neutral[500] : "#fff",
      borderColor: disabled ? "transparent" : colors.primary[600],
    };
  }

  if (variant === "secondary") {
    return {
      ...base,
      background:  "transparent",
      color:       disabled ? colors.neutral[400] : colors.primary[700],
      borderColor: disabled ? colors.neutral[200] : colors.primary[600],
    };
  }

  // tertiary
  return {
    ...base,
    background:  "transparent",
    color:       disabled ? colors.neutral[400] : colors.neutral[600],
    borderColor: "transparent",
  };
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

const spinnerStyle: React.CSSProperties = {
  display:     "inline-block",
  width:       "1em",
  height:      "1em",
  borderRadius: "50%",
  border:      "2px solid currentColor",
  borderTopColor: "transparent",
  animation:   "btn-spin 0.6s linear infinite",
  flexShrink:  0,
};

const spinnerKeyframes = `@keyframes btn-spin { to { transform: rotate(360deg); } }`;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Button — the primary interactive control across CarbonLedger.
 *
 * Use `variant` to express hierarchy:
 * - **primary**: one per section/page (Buy, Retire, Connect Wallet).
 * - **secondary**: complementary actions (View details, Download).
 * - **tertiary**: low-emphasis (Cancel, Skip, Clear filters).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant    = "primary",
    size       = "md",
    loading    = false,
    leadingIcon,
    trailingIcon,
    fullWidth  = false,
    disabled,
    children,
    style,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const computedStyle = buildStyle(variant, size, isDisabled, fullWidth);

  return (
    <>
      <style>{spinnerKeyframes}</style>
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        style={{ ...computedStyle, ...style }}
        {...rest}
      >
        {loading ? (
          <>
            <span style={spinnerStyle} aria-hidden="true" />
            <span>{children}</span>
          </>
        ) : (
          <>
            {leadingIcon && <span aria-hidden="true">{leadingIcon}</span>}
            {children}
            {trailingIcon && <span aria-hidden="true">{trailingIcon}</span>}
          </>
        )}
      </button>
    </>
  );
});

export default Button;
