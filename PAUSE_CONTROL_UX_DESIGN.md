# Pause Control Interaction Flow — UI/UX Design (#1171)

Design spec for the pause/unpause control: placement, confirmation, success, error, and edge cases.

## 1. Button placement & states

- **Location:** Primary action bar of the automation/agent detail header, right-aligned next to the status badge. On list rows, a compact icon-only variant appears in the row action menu.
- **Label:** `Pause` when running; `Resume` when paused.
- **Icon:** pause glyph (`⏸`) / play glyph (`▶`).
- **Visual states:**
  - Default (running): secondary button, neutral border.
  - Hover/focus: elevated border + focus ring (keyboard accessible).
  - Loading: button disabled, inline spinner, label `Pausing…` / `Resuming…`.
  - Disabled: when status is `completed`, `failed`, or user lacks permission — tooltip explains why.
- **Status badge** reflects `Running` / `Paused` / `Pausing…` / `Resuming…`.

```
┌───────────────────────────────────────────────┐
│  Agent: Data Sync        [● Running]  [⏸ Pause] │
└───────────────────────────────────────────────┘
```

## 2. Confirmation dialog

Shown for **pause** (destructive-ish: interrupts work). **Resume** proceeds without a dialog (non-destructive).

```
┌─────────────────────────────────────────────┐
│  Pause this agent?                          │
│                                             │
│  In-flight tasks will finish their current  │
│  step, then the agent stops accepting new   │
│  work. You can resume at any time.          │
│                                             │
│  Reason (optional)                          │
│  ┌───────────────────────────────────────┐  │
│  │ e.g. maintenance window               │  │
│  └───────────────────────────────────────┘  │
│                                             │
│              [ Cancel ]   [ Pause agent ]   │
└─────────────────────────────────────────────┘
```

- Primary action `Pause agent` (danger-tinted), secondary `Cancel`.
- `Esc` / backdrop click cancels; focus trapped; default focus on `Cancel`.
- Optional reason field feeds the pause history (see PR title: pause reason/history UI).

## 3. Success state

- Dialog closes; toast: `Agent paused` with optional `Undo` (resume) action.
- Status badge transitions to `Paused`; button becomes `Resume`.
- Pause history entry appended: timestamp, actor, reason.

```
┌───────────────────────────────────────────────┐
│  Agent: Data Sync        [⏸ Paused]  [▶ Resume] │
└───────────────────────────────────────────────┘
  ✓ Agent paused · Undo
```

## 4. Error states

| Scenario | UI |
|---|---|
| Network/server error | Inline error in dialog: `Couldn't pause the agent. Try again.` with `Retry`; dialog stays open. |
| Permission denied (403) | Toast: `You don't have permission to pause this agent.` Button disabled with tooltip. |
| Conflict (already paused / state changed) | Toast: `Agent is already paused.` Refresh status badge. |
| Timeout | Toast: `Pause request timed out. Check status.` Re-fetch status. |

- Errors never leave the UI in a false `Paused` state; status is re-fetched after any failure.

## 5. Edge cases

- **Double-click / rapid toggle:** button disabled while request in flight; idempotent request.
- **In-flight tasks:** copy clarifies current step finishes before full stop.
- **Concurrent change by another user:** conflict handled via re-fetch + toast.
- **Resume while pausing:** queue or block until pause settles; show `Pausing…`.
- **Offline:** disable control, tooltip `Reconnect to change state`.
- **Long reason text:** truncate in history with expand-on-hover.
- **Accessibility:** `aria-live` on status badge and toasts; full keyboard path; color-independent state (icon + text).
