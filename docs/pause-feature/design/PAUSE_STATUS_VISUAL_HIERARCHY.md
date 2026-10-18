# Pause status — visual hierarchy

**Issue:** #1260  
**Scope:** Design specification for contract pause indicators, banners, and supporting details. This document does not change components or global brand colors.

## 1. Intent and hierarchy

A paused contract is an operational interruption, not a routine success/failure notification. Make it immediately recognizable without allowing the status treatment to overwhelm the page.

| Priority | Element | Paused | Unpaused |
| --- | --- | --- | --- |
| 1 — interruption | Full-width banner above affected workflows | Red pause icon, **Contract paused**, impact summary, optional reason and details link | No interruption banner |
| 2 — persistent status | Header/status badge | Red pause icon + **Paused** | Gray check-circle icon + **Unpaused** |
| 3 — explanation | Contract details panel | Reason, paused-by identity, pause time, last successful sync | **Operations available**, last successful sync |
| 4 — supporting metadata | Freshness/error annotation | Neutral text beneath status; never replace a known pause with “Unpaused” | Neutral text beneath status; mark stale status when sync fails |

**Red is the primary pause-feature color; gray is secondary.** Do not use green for the unpaused state. Keep the application's existing green brand tokens unchanged: use component-scoped `--pause-*` tokens instead.

Use the same labels everywhere: **Paused**, **Unpaused**, **Checking status…**, and **Status unavailable**. “Unpaused” describes the contract flag, not the health of every backend service.

## 2. Semantic palette and light/dark variants

Use the explicit colors below, selected by the existing `data-theme="dark"` convention. The neutral values align with `frontend/styles/theme.css`; the red values are scoped to pause UI.

| Token / use | Light | Dark |
| --- | --- | --- |
| `--pause-primary` — pause action fill | `#DC2626` | `#F87171` |
| `--pause-primary-hover` | `#B91C1C` | `#FCA5A5` |
| `--pause-primary-pressed` | `#991B1B` | `#EF4444` |
| `--pause-primary-on` — solid action label | `#FFFFFF` | `#450A0A` |
| `--pause-paused-bg` — badge/banner surface | `#FEF2F2` | `#450A0A` |
| `--pause-paused-text` — label and explanation | `#991B1B` | `#FECACA` |
| `--pause-paused-icon` | `#B91C1C` | `#F87171` |
| `--pause-paused-border` | `#DC2626` | `#F87171` |
| `--pause-secondary-bg` — unpaused/unknown surface | `#F3F4F6` | `#1F2937` |
| `--pause-secondary-hover` | `#E5E7EB` | `#374151` |
| `--pause-secondary-text` | `#374151` | `#F3F4F6` |
| `--pause-secondary-icon` | `#4B5563` | `#D1D5DB` |
| `--pause-secondary-border` | `#6B7280` | `#9CA3AF` |
| `--pause-muted-text` — timestamps/helper copy | `#6B7280` | `#D1D5DB` |
| `--pause-focus` — focus outline | `#111827` | `#F9FAFB` |
| `--pause-surface` — details panel | `#FFFFFF` | `#111827` |

- Status badge: tinted surface, 1 px semantic border, matching icon and label. Avoid glow effects.
- Banner: tinted red surface with a 4 px leading red rule; the title has the strongest text weight. Keep reason text readable, not faint.
- Primary **Pause contract** action: solid primary fill and on-primary text. Secondary **Unpause contract** action: gray surface, border, and text. The action verb remains explicit; neither button is a status indicator.
- Disabled actions retain readable labels, use the gray treatment, and explain why they are unavailable. Do not reduce the entire control to low opacity.
- Links inherit the readable foreground and are underlined; color alone must not signal interactivity.
- No gradients, pulsing red dots, flashing surfaces, or theme-dependent changes of meaning.

## 3. Typography

Use the repository's existing system stack; do not introduce a webfont:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

| Element | Font size | Line height | Weight |
| --- | --- | --- | --- |
| Banner title | 18 px / 1.125 rem | 26 px | 600 |
| Details section title | 16 px / 1 rem | 24 px | 600 |
| Banner explanation / reason | 14 px / 0.875 rem | 22 px | 400 |
| Badge label | 14 px / 0.875 rem | 20 px | 600 |
| Button label | 14 px / 0.875 rem | 20 px | 600 |
| Details value | 14 px / 0.875 rem | 22 px | 400 |
| Metadata / timestamp | 12 px / 0.75 rem | 18 px | 400 |

Prefer sentence case, normal letter spacing, and no all-caps warnings. Use tabular numerals for timestamps/durations. Show human-readable local time with timezone; offer the full timestamp in details. Long reasons and identities must wrap or provide an accessible expansion, not force horizontal scrolling.

## 4. Icon designs

Use inline SVG, `viewBox="0 0 24 24"`, `currentColor`, 2 px strokes, and round caps/joins. No new icon library is required. These geometries are specifications, not new image assets.

| State | Geometry on the 24 × 24 grid | Meaning |
| --- | --- | --- |
| Paused | Outlined circle centered at `(12, 12)`, radius `9`; two vertical bars at `x=9` and `x=15`, each from `y=8` to `y=16` | Pause symbol; always accompanied by **Paused** |
| Unpaused | Same circle; check path `M7 12 L10 15 L17 8` | Operations not paused; always accompanied by **Unpaused** |
| Checking | Same circle with a short open arc and two small breaks; static unless motion is allowed | Unknown while requesting status |
| Unavailable / stale annotation | Same circle with vertical line `M12 7 L12 12` and dot centered at `(12, 16)` | Sync availability, not a pause transition |

- Badge icon: **16 × 16 px**. Banner icon: **24 × 24 px**. Details icon: **20 × 20 px**.
- Maintain an **8 px** icon-to-label gap (12 px in the banner).
- Icons with adjacent text are decorative: `aria-hidden="true"` and `focusable="false"`.
- Do not replace the unpaused icon with a play button: that implies an action rather than status.
- A status dot alone is insufficient; icon shape and visible label must communicate state without color.

## 5. Layout, spacing, and sizes

Use the existing mobile-first layout and a 4 px spacing grid.

| Component | Size and spacing |
| --- | --- |
| Header badge | Minimum visual height 32 px; 6 px vertical / 12 px horizontal padding; 8 px internal gap; pill radius 999 px |
| Interactive badge/link | Minimum **48 × 48 px** hit area, matching existing global touch-target styles; the visible badge can remain 32 px high |
| Banner | Minimum height 64 px, growing with content; 16 px padding; 12 px icon/content gap; 8 px title/body gap; no fixed maximum height |
| Banner actions | 12 px separation from explanation; each interactive target at least 48 px high |
| Details panel | 16 px padding; 8 px radius; 1 px neutral border; 16 px section gap; 8 px label/value gap |
| Action buttons | Minimum height 48 px; 12 px vertical / 16 px horizontal padding; 6 px radius |
| Focus outline | 2 px solid focus token, 2 px offset; never clipped by the container |

At widths below **640 px**, allow the banner's text and actions to stack, align the icon with the title, and wrap metadata onto its own line. At wider widths, actions may align to the trailing edge. Keep the status label and icon together; supplementary timestamps may move to details. Do not hide state or reason solely to fit a header.

## 6. Loading, errors, and freshness

- Before any known state: show the gray checking treatment, not **Unpaused**.
- Restored localStorage status is provisional. Retain its status shape/color, add **Checking status…**, and show the stored last-update time until backend confirmation.
- On a successful sync, show `lastUpdated` as the local time of the last successful backend response, even when the status is unchanged. It is separate from the server's pause time or event `updatedAt`.
- On sync failure with a known status, keep it visible and add **Unable to refresh; showing last known status**, the last-update time, and a retry affordance.
- On sync failure without a known status, use the gray unavailable treatment. Never imply that operations are safe merely because a request failed.
- An unpause removes the interruption banner; it does not recolor every component or generate repeated alerts on every successful poll.

## 7. Accessibility and motion

- Combine **text + distinct icon + color** in every status presentation.
- Require WCAG AA: at least **4.5:1** for normal text and **3:1** for meaningful icon outlines, focus indicators, and control boundaries against adjacent surfaces. Re-check actual rendered token pairings during UI implementation, including hover/pressed/disabled states.
- Use a status live region (`role="status"`, polite) for actual status transitions. Use `role="alert"` for a newly detected pause that interrupts the current workflow, not on every poll or timestamp update.
- Keep last-sync timestamps outside the live region so periodic freshness updates do not repeatedly announce.
- Any details tooltip must also work on keyboard focus and touch; essential reason/error information belongs in the visible details panel.
- No automatic motion is necessary. If a checking arc rotates, use at most one slow rotation per second and disable it under `prefers-reduced-motion: reduce`.
- Status UI is informational; backend/contract authorization and pause enforcement remain authoritative.
