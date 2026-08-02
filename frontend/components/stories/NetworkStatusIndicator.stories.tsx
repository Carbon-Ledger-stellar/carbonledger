import type { Meta, StoryObj } from '@storybook/react';
import NetworkStatusIndicator from '../NetworkStatusIndicator';
import { SyncStatus, ConflictRecord } from '../../hooks/useAuditSync';

const meta: Meta<typeof NetworkStatusIndicator> = {
  title: 'Components/NetworkStatusIndicator',
  component: NetworkStatusIndicator,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    onDismissConflicts: { action: 'onDismissConflicts' },
    onManualSync: { action: 'onManualSync' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Online: Story = {
  args: {
    isOnline: true,
    syncStatus: 'idle' as SyncStatus,
    conflicts: [],
    lastSyncAt: Date.now() - 60000,
    onDismissConflicts: () => {},
    onManualSync: () => {},
  },
};

export const Offline: Story = {
  args: {
    isOnline: false,
    syncStatus: 'idle' as SyncStatus,
    conflicts: [],
    lastSyncAt: Date.now() - 300000,
    onDismissConflicts: () => {},
    onManualSync: () => console.log('Retry clicked'),
  },
};

export const Syncing: Story = {
  args: {
    isOnline: true,
    syncStatus: 'syncing' as SyncStatus,
    conflicts: [],
    lastSyncAt: null,
    onDismissConflicts: () => {},
    onManualSync: () => {},
  },
};

export const Conflict: Story = {
  args: {
    isOnline: true,
    syncStatus: 'idle' as SyncStatus,
    conflicts: [
      { id: 'c1', entityType: 'audit', entityId: 'e1', localVersion: 1, serverVersion: 2, resolvedAt: null } as ConflictRecord,
      { id: 'c2', entityType: 'project', entityId: 'e2', localVersion: 3, serverVersion: 4, resolvedAt: null } as ConflictRecord,
    ],
    lastSyncAt: Date.now() - 120000,
    onDismissConflicts: () => console.log('Dismiss clicked'),
    onManualSync: () => {},
  },
};

export const SyncError: Story = {
  args: {
    isOnline: true,
    syncStatus: 'error' as SyncStatus,
    conflicts: [],
    lastSyncAt: null,
    onDismissConflicts: () => {},
    onManualSync: () => console.log('Retry clicked'),
  },
};

export const BackOnline: Story = {
  args: {
    isOnline: true,
    syncStatus: 'success' as SyncStatus,
    conflicts: [],
    lastSyncAt: Date.now(),
    onDismissConflicts: () => {},
    onManualSync: () => {},
  },
};
