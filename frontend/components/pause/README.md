# Pause UI Component Library

A reusable, accessible component library for CarbonLedger contract pause state visualization and emergency administration.

## Components

### 1. `PauseStatusIndicator`
Displays the real-time operational state of smart contracts across the platform.

```tsx
import { PauseStatusIndicator } from '@/components/pause';

<PauseStatusIndicator status="operational" size="md" />
<PauseStatusIndicator status="paused" pausedUntil={1727280000} size="sm" />
```

**Props:**
- `status`: `'operational' | 'paused' | 'expiring_soon' | 'loading'`
- `size`: `'sm' | 'md' | 'lg'` (default: `'md'`)
- `showLabel`: `boolean` (default: `true`)
- `pausedUntil`: `number` (optional Unix timestamp in seconds)
- `className`: `string`

### 2. `PauseButton`
Action button tailored for administrative screens to trigger or lift contract pauses.

```tsx
import { PauseButton } from '@/components/pause';

<PauseButton
  isPaused={isPaused}
  onInitiateAction={() => setModalOpen(true)}
  isLoading={loading}
/>
```

**Props:**
- `isPaused`: `boolean`
- `onInitiateAction`: `() => void`
- `isLoading`: `boolean` (default: `false`)
- `disabled`: `boolean` (default: `false`)
- `variant`: `'primary' | 'secondary' | 'outline'` (default: `'primary'`)
- `size`: `'sm' | 'md' | 'lg'` (default: `'md'`)

### 3. `PauseBanner`
System-level notification banner shown to users across the dApp when contract operations are halted.

```tsx
import { PauseBanner } from '@/components/pause';

<PauseBanner
  isPaused={isPaused}
  reason="Emergency maintenance in progress"
  pausedUntil={1727280000}
  onViewDetails={() => navigateToStatus()}
/>
```

**Props:**
- `isPaused`: `boolean`
- `reason`: `string` (optional custom reason)
- `pausedUntil`: `number` (optional Unix timestamp in seconds)
- `isDismissible`: `boolean` (default: `true`)
- `onDismiss`: `() => void`
- `onViewDetails`: `() => void`

### 4. `PauseConfirmModal`
Accessible confirmation dialog with duration limits (maximum 72 hours) and mandatory incident reason for audit compliance.

```tsx
import { PauseConfirmModal } from '@/components/pause';

<PauseConfirmModal
  isOpen={modalOpen}
  action={isPaused ? 'unpause' : 'pause'}
  onConfirm={async (durationHours, reason) => {
    await executePause({ durationHours, reason });
    setModalOpen(false);
  }}
  onCancel={() => setModalOpen(false)}
/>
```

## Accessibility Features
- Full keyboard trap in modal dialogs with Escape key support.
- `aria-live="polite"` on status updates and `aria-live="assertive"` on emergency banners.
- WCAG AA compliant color contrasts across both light and dark themes.
