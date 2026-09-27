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
