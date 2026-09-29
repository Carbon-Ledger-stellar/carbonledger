# Pause UI Implementation & Usage Guidelines

This document provides design principles, integration patterns, and best practices for presenting contract pause states across CarbonLedger applications.

---

## 1. Principles of Pause UI Design
1. **Immediate Clarity**: Users must instantly understand why an action is blocked without encountering ambiguous errors.
2. **Graceful Read-Only Access**: Users can still browse portfolios, inspect certificates, and review historical retirements while transactions are paused.
3. **Transparent Recovery**: Display remaining time estimates and operational status updates wherever possible.

---

## 2. Correct vs Incorrect Patterns

### Banner Placement
- **DO**: Mount `PauseBanner` globally at the top of application layout above the navbar or sub-header so it is visible on all transaction-capable views.
- **DON'T**: Hide pause alerts inside individual checkout steps or only show an error toast after a transaction submission fails.

### Action Button States
- **DO**: Disable purchase, transfer, and retirement buttons with a clear tooltip: `"Contract paused for emergency maintenance"`.
- **DON'T**: Leave buttons active and let the Soroban RPC call fail with error `EmergencyPaused (29)`.

### Polling & Real-Time Sync
- **DO**: Connect to the real-time WebSocket or poll `/api/v1/contract/status` every 30 seconds during active user sessions.
- **DON'T**: Query status on every mouse movement or keystroke.

---

## 3. Implementation Code Example

```tsx
import React from 'react';
import { PauseBanner, PauseStatusIndicator } from '@/components/pause';
import { useContractPauseStatus } from '@/hooks/useContractPauseStatus';

export function ApplicationShell({ children }: { children: React.ReactNode }) {
  const { isPaused, reason, pausedUntil, status } = useContractPauseStatus();

  return (
    <div className="min-h-screen flex flex-col">
      <PauseBanner
        isPaused={isPaused}
        reason={reason}
        pausedUntil={pausedUntil}
        onViewDetails={() => window.open('https://status.carbonledger.io', '_blank')}
      />
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">CarbonLedger</h1>
        <PauseStatusIndicator status={status} size="sm" />
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

---

## 4. Accessibility Checklist (WCAG 2.1 AA)

- [x] Status indicators use textual labels and icons in addition to color (avoid color-only status signaling).
- [x] Emergency banners use `role="alert"` and `aria-live="assertive"`.
- [x] Non-emergency status changes use `aria-live="polite"`.
- [x] Pause modals trap keyboard focus and allow closing with `Escape`.
- [x] Contrast ratio for all status badges and buttons exceeds 4.5:1 against their backgrounds.

---

## 5. Common Pitfalls to Avoid
- **Failing to clear cached pause state**: Ensure client-side cache TTL does not exceed 60 seconds for status queries.
- **Hard-coded durations**: Never hard-code pause expiration times on the client; always read `pausedUntil` from contract storage or API.
- **Silent failures**: Always present user-friendly messaging when an API returns 409/423 (Contract Paused).
