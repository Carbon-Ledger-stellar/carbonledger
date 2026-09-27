# Implementation Guide

This guide documents UI/UX design specifications for the pause feature set.

## Pause Stats Dashboard (Issue #1176)

Design specification for the pause statistics dashboard, presenting charts, tables, and key metrics about pause patterns.

### Chart Type Designs

**Line Chart — Pause Frequency Over Time**
- X-axis: date/time buckets (hourly, daily, weekly depending on selected range).
- Y-axis: count of pauses.
- Single or multi-series (one line per pause reason or per user/team).
- Smooth curve, 2px stroke, subtle gradient fill under the line.
- Hover tooltip shows exact timestamp and count; vertical guide line on hover.
- Legend toggles series visibility.

**Pie Chart — Pause Reason Distribution**
- Segments sized by proportion of total pauses per reason.
- Max 6 segments; remaining grouped into an "Other" slice.
- Percentage labels on segments ≥ 5%; full breakdown in tooltip.
- Donut variant (inner radius ~60%) with total count centered.
- Consistent color palette shared with the line chart series.

**Bar Chart — Pauses by Category**
- Vertical bars for short category labels; horizontal bars when labels are long.
- Grouped or stacked bars to compare categories across time periods.
- Rounded top corners, 4px gap between bars.
- Value labels above bars when space allows; tooltip otherwise.
- Highlighted bar on hover with a slightly darker shade.

### Data Table Layout

- Columns: Date, User/Team, Pause Reason, Duration, Count, Actions.
- Sticky header row; zebra striping for readability.
- Sortable columns with ascending/descending indicators.
- Pagination controls at the bottom (page size selector, prev/next, page numbers).
- Row hover highlight; clickable rows open a detail view.
- Empty state with an illustration and a short explanatory message.
- Loading state uses skeleton rows matching the column layout.

### Metric Card Designs

- Grid of cards, each showing: label, primary value, and trend indicator.
- Key metrics: Total Pauses, Average Duration, Most Common Reason, Pauses This Period.
- Trend indicator shows delta vs. previous period with up/down arrow and color (green/red).
- Optional sparkline in the card footer for at-a-glance trend.
- Consistent card padding, rounded corners, and subtle border/shadow.

### Date Range Picker Design

- Preset ranges: Today, Last 7 days, Last 30 days, This month, Custom.
- Custom range opens a dual-month calendar for start/end selection.
- Selected range highlighted; hover previews the range.
- Quick "Apply" and "Cancel" actions; presets apply immediately.
- Displays the active range as a readable label (e.g., "Jan 1 – Jan 31, 2024").
- Keyboard accessible: arrow keys navigate days, Enter selects.

### Mobile Responsive Design

- Charts stack vertically and resize to full width; legends move below the chart.
- Data table switches to a card list on small screens, one card per row.
- Metric cards reflow to a single column (or two on tablets).
- Date range picker opens as a full-screen sheet with a single-month calendar.
- Touch targets ≥ 44px; tooltips replaced by tap-to-reveal panels.
- Filters collapse into a toggleable panel to preserve vertical space.

## Pause Error Message Hierarchy (Issue #1177)

Design specification for consistent error messages shown when pause-related actions fail, with a clear visual hierarchy and actionable user guidance.

### Error Severity Levels

Pause errors are grouped into three severity levels, each with a distinct visual treatment:

| Level | When to use | Example |
| --- | --- | --- |
| **Inline / Field** | A single input is invalid; the rest of the form is usable. | "Pause duration must be at least 1 minute." |
| **Blocking / Action** | The pause action itself failed and cannot proceed. | "Couldn't pause the session. Please try again." |
| **System / Banner** | Pause service is unavailable or degraded. | "Pause service is temporarily unavailable." |

### Icon and Color Usage

- **Inline / Field** — Warning icon (`alert-circle`), color `--color-warning-600` (#B45309) on `--color-warning-50` (#FFFBEB) background. Border-left 3px accent.
- **Blocking / Action** — Error icon (`alert-triangle`), color `--color-error-600` (#B91C1C) on `--color-error-50` (#FEF2F2) background. Border-left 3px accent.
- **System / Banner** — Error icon (`alert-octagon`), color `--color-error-700` (#991B1B) on `--color-error-100` (#FEE2E2) background. Full-width banner.
- Icons are 16px (inline), 20px (blocking), 24px (banner), vertically aligned to the first line of text.
- Never rely on color alone: every level pairs its color with a distinct icon and text label.
- Success and info states reuse the same layout with `check-circle` / `info` icons and green/blue tokens respectively.

### Typography Scale

- **Title** — 14px / 20px line-height, weight 600, `--color-error-700` (or matching severity token). One short sentence, sentence case, no trailing period.
- **Body / Guidance** — 13px / 18px line-height, weight 400, `--color-neutral-700`. Explains what happened and what to do next; max 2 lines.
- **Field label / inline text** — 12px / 16px line-height, weight 500, matching severity color.
- **Error code / reference** — 12px / 16px, weight 400, `--color-neutral-500`, monospace, shown only when a support reference exists.
- Keep messages under ~120 characters; avoid jargon and never expose raw stack traces.

### Action Button Design

- Primary recovery action (e.g., "Try again", "Retry pause") uses the standard primary button: 32px height, 8px horizontal padding, 13px/500 label, `--color-error-600` background with white text for blocking errors.
- Secondary action (e.g., "Dismiss", "View details") uses a ghost/text button: transparent background, `--color-neutral-600` label, underline on hover.
- Inline field errors show no button; the fix is editing the field itself.
- Banner errors include a single "Retry" button plus a "Dismiss" text action; never more than two actions.
- Buttons are right-aligned within the message container with 8px gap; on mobile they stack full-width.
- Disabled while the retry is in flight, showing a 16px inline spinner and label "Retrying…".

### Animation / Transition Specs

- **Enter** — fade in + 4px upward slide, 150ms, `ease-out`. Banner slides down from the top edge instead.
- **Exit** — fade out, 100ms, `ease-in`; collapse height over 150ms to avoid layout jump.
- **Auto-dismiss** — inline and blocking messages auto-dismiss after 6s; system banners persist until resolved or dismissed.
- **Retry feedback** — spinner rotates 800ms linear infinite; on success the message cross-fades to a success state over 200ms.
- **Reduced motion** — when `prefers-reduced-motion: reduce` is set, skip slide/collapse and use opacity-only transitions (≤ 100ms).
- **Focus** — on appearance, move focus to the message container (`role="alert"`, `aria-live="assertive"`) so screen readers announce it immediately.
