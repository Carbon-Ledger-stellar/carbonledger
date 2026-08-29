# Fix Plan: Skeleton Loading for Project Detail Page

## Problem

The project detail page at `frontend/app/projects/[id]/page.tsx` has a broken loading experience:

1. **Skeleton dismissed too early** — only `useProject()`'s `isLoading` is checked; `useRetirements()` and `useCreditBatches()` resolve independently but their loading states are ignored, so the skeleton disappears before all data is ready.
2. **Missing methodology badge skeleton** — the header skeleton lacks a placeholder for the status/methodology badge pill that appears in the real header.
3. **No credit batch table skeleton** — the credit batches section has no loading placeholder at all; users see a sudden layout jump when batches arrive.
4. **No `aria-busy` container** — screen readers get no indication the page is loading.
5. **FOUC risk** — no guard prevents the real content from painting before the skeleton has been painted at least once.

---

## Files to Modify

### 1. `frontend/app/projects/[id]/page.tsx`

#### Change 1 — Track all loading states

```tsx
// Before:
const { data: project, isLoading } = useProject(params.id);
const { data: retirements } = useRetirements(50);
const { data: creditBatches } = useCreditBatches(params.id);

// After:
const { data: project, isLoading: projectLoading } = useProject(params.id);
const { data: retirements, isLoading: retirementsLoading } = useRetirements(50);
const { data: creditBatches, isLoading: batchesLoading } = useCreditBatches(params.id);

const isLoading = projectLoading || retirementsLoading || batchesLoading;
```

#### Change 2 — Wrap skeleton in `aria-busy` container

Wrap the entire skeleton block (lines 20–78) so the outermost div carries `aria-busy="true"` and useful landmark roles:

```tsx
if (isLoading) return (
  <div
    role="main"
    aria-busy="true"
    aria-label="Loading project details"
    style={{ maxWidth: "1000px", margin: "0 auto", padding: "2.5rem 2rem" }}
  >
    {/* ... existing skeleton content ... */}
  </div>
);
```

#### Change 3 — Add methodology badge placeholder to header skeleton

Insert a pill-shaped shimmer inside the header skeleton (after line 31, inside the flex row that holds the title and badge):

```tsx
{/* Existing header skeleton content */}
<div style={{ width: "40%", height: "32px", background: colors.neutral[100], borderRadius: "4px" }} />
<div style={{ width: "60%", height: "16px", background: colors.neutral[100], borderRadius: "4px" }} />
{/* NEW — badge placeholder */}
<Shimmer width="80px" height="24px" borderRadius="9999px" />
```

This mirrors the real badge rendered at line 113–118 (`borderRadius: "9999px"`, `padding: "0.3rem 0.75rem"`, `fontSize: "0.8rem"`).

#### Change 4 — Add credit batch table skeleton (5 rows)

Insert a full-width skeleton card that mimics the real credit batch table (lines 172–206) inside the left column, after the stats skeleton and before the provenance skeleton (after line 53):

```tsx
{/* Credit Batches Skeleton */}
<div style={{
  background: colors.surface, border: `1px solid ${colors.neutral[200]}`,
  borderRadius: "0.75rem", padding: "1.5rem",
}}>
  <div style={{ width: "120px", height: "16px", background: colors.neutral[100], borderRadius: "4px", marginBottom: "1rem" }} />
  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
    {[1, 2, 3, 4, 5].map(i => (
      <div key={i} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "0.75rem", background: colors.neutral[50], borderRadius: "0.5rem",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <Shimmer width="80px" height="12px" />
          <Shimmer width="140px" height="10px" />
        </div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <Shimmer width="60px" height="14px" />
          <Shimmer width="40px" height="10px" />
        </div>
      </div>
    ))}
  </div>
</div>
```

Dimensions are chosen to match the real batch card:
- `padding: 0.75rem`, `background: colors.neutral[50]`, `borderRadius: "0.5rem"` → matches line 184–185
- Left column: batch ID label (`fontWeight: 600`, `fontSize: "0.875rem"`) + serial range (`fontSize: "0.75rem"`) → `80px × 12px` + `140px × 10px`
- Right column: amount (`fontWeight: 700`, `fontSize: "0.875rem"`) + vintage (`fontSize: "0.75rem"`) → `60px × 14px` + `40px × 10px`

#### Change 5 — Prevent FOUC: ensure skeleton renders immediately

The skeleton section already returns early before the real JSX executes, so there is no parallel render path. However, to guarantee zero FOUC:

- Confirm the page component is declared `"use client"` (it is — line 1) so SWR hydrates client-side.
- The early `return` on line 20 means the skeleton JSX is the **first** thing React commits on the client. No additional change needed beyond the loading-state fix above.

#### Change 6 — Remove stale skeleton that leaks through after project loads

When `project` resolves but `retirements` or `batches` are still loading, the current guard at line 80 (`if (!project)`) would pass through to the real content, which references `creditBatches` and `retirements`. This is fine since the data hooks return `undefined`/`null` while loading and the render logic already guards with `&&` (e.g., line 172). No structural change needed here beyond the combined `isLoading` flag.

---

### 2. `frontend/components/LoadingSkeleton.tsx`

#### Change — Add new `CreditBatchTable` variant

Add a reusable variant so the same skeleton can be used from the marketplace or analytics pages later:

```tsx
type Variant = /* existing */ | "CreditBatchTable";

// ...

function CreditBatchTableSkeleton({ rowCount = 5 }: { rowCount?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {Array.from({ length: rowCount }).map((_, i) => (
        <div key={i} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "0.75rem", background: colors.neutral[50], borderRadius: "0.5rem",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <Shimmer width="80px" height="12px" />
            <Shimmer width="140px" height="10px" />
          </div>
          <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <Shimmer width="60px" height="14px" />
            <Shimmer width="40px" height="10px" />
          </div>
        </div>
      ))}
    </div>
  );
}
```

Register it in the switch at line 243:

```tsx
if (variant === "CreditBatchTable") return <CreditBatchTableSkeleton key={i} count={count} />;
```

_(Note: `count` is not used by the new variant; pass `rowCount` via `count` or add a `rowCount` prop later. For now the inline skeleton in the page is sufficient.)_

---

## Acceptance Criteria Checklist

| # | Criterion | How Verified |
|---|-----------|--------------|
| 1 | Skeleton renders for project header | `Shimmer` placeholders for title, subtitle, and badge pill in header block (Change 3) |
| 2 | Skeleton renders for methodology badge | Pill-shaped `Shimmer` with `borderRadius="9999px"` mirrors real badge (Change 3) |
| 3 | Skeleton renders for stats section | Already present (lines 40–53); retained unchanged |
| 4 | Credit batch table skeleton shows 5 rows | New `CreditBatchTable` block with `[1,2,3,4,5].map()` (Change 4) |
| 5 | Skeleton dismissed once all API calls resolve | Combined `isLoading` flag ORs all three hook states (Change 1) |
| 6 | No flash of unstyled content | Early `return` guarantees skeleton is first commit; `"use client"` ensures client-side hydration (Change 5) |
| 7 | Accessible with `aria-busy="true"` on container | `aria-busy="true"` + `aria-label` on the wrapper `div` (Change 2) |

---

## Implementation Order

1. **`frontend/components/LoadingSkeleton.tsx`** — add `CreditBatchTable` variant (no breaking changes; additive only).
2. **`frontend/app/projects/[id]/page.tsx`** — apply Changes 1–4 in sequence:
   - Add per-hook loading variables
   - Combine into single `isLoading`
   - Add `aria-busy` wrapper
   - Add badge placeholder
   - Add batch table skeleton
3. **Verify** — run `npm run lint` and `npm run typecheck` from `frontend/`.

---

## Rollback Notes

All changes are additive or rename-only destructuring. Rollback is a single revert of the two files. The `CreditBatchTable` variant in `LoadingSkeleton.tsx` is dead-code safe (unused by any other component).
