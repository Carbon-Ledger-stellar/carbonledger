import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import {
  PauseStatusIndicator,
  PauseButton,
  PauseBanner,
  PauseConfirmModal,
  PauseStatus,
} from '../pause';

const meta: Meta = {
  title: 'Components/PauseSystem',
  parameters: {
    layout: 'padded',
  },
};

export default meta;

export const StatusIndicators: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-4">
        <span className="w-32 text-sm text-gray-500 font-medium">Operational:</span>
        <PauseStatusIndicator status="operational" size="md" />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-32 text-sm text-gray-500 font-medium">Paused:</span>
        <PauseStatusIndicator
          status="paused"
          size="md"
          pausedUntil={Math.floor(Date.now() / 1000) + 7200}
        />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-32 text-sm text-gray-500 font-medium">Expiring Soon:</span>
        <PauseStatusIndicator
          status="expiring_soon"
          size="md"
          pausedUntil={Math.floor(Date.now() / 1000) + 1200}
        />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-32 text-sm text-gray-500 font-medium">Loading:</span>
        <PauseStatusIndicator status="loading" size="md" />
      </div>
    </div>
  ),
};

export const ActionButtons: StoryObj = {
  render: () => {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-4">
          <span className="w-36 text-sm text-gray-500">Ready to pause:</span>
          <PauseButton isPaused={false} onInitiateAction={() => alert('Initiate pause')} />
        </div>
        <div className="flex items-center gap-4">
          <span className="w-36 text-sm text-gray-500">Currently paused:</span>
          <PauseButton isPaused={true} onInitiateAction={() => alert('Initiate unpause')} />
        </div>
        <div className="flex items-center gap-4">
          <span className="w-36 text-sm text-gray-500">Loading state:</span>
          <PauseButton isPaused={false} isLoading={true} onInitiateAction={() => {}} />
        </div>
        <div className="flex items-center gap-4">
          <span className="w-36 text-sm text-gray-500">Disabled state:</span>
          <PauseButton isPaused={false} disabled={true} onInitiateAction={() => {}} />
        </div>
      </div>
    );
  },
};

export const SystemBanner: StoryObj = {
  render: () => (
    <div className="space-y-4">
      <PauseBanner
        isPaused={true}
        reason="Scheduled maintenance and circuit-breaker verification."
        pausedUntil={Math.floor(Date.now() / 1000) + 14400}
        onViewDetails={() => alert('Viewing system status')}
      />
      <PauseBanner
        isPaused={true}
        reason="Emergency halt triggered due to anomalous off-chain indexer variance."
        isDismissible={false}
      />
    </div>
  ),
};

export const ConfirmationModal: StoryObj = {
  render: () => {
    const [open, setOpen] = useState(false);
    const [action, setAction] = useState<'pause' | 'unpause'>('pause');

    return (
      <div className="p-4 space-x-4">
        <button
          className="px-4 py-2 bg-rose-600 text-white rounded text-sm font-medium"
          onClick={() => {
            setAction('pause');
            setOpen(true);
          }}
        >
          Open Pause Modal
        </button>
        <button
          className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium"
          onClick={() => {
            setAction('unpause');
            setOpen(true);
          }}
        >
          Open Resume Modal
        </button>
        <PauseConfirmModal
          isOpen={open}
          action={action}
          onConfirm={(duration, reason) => {
            alert(`Confirmed ${action}: duration=${duration}h, reason=${reason}`);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </div>
    );
  },
};
