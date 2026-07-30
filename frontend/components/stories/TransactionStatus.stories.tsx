import type { Meta, StoryObj } from '@storybook/react';
import TransactionStatus, { TxStatus } from '../TransactionStatus';

const meta: Meta<typeof TransactionStatus> = {
  title: 'Components/TransactionStatus',
  component: TransactionStatus,
  parameters: { layout: 'padded' },
  argTypes: {
    status: {
      control: 'select',
      options: ['building', 'signing', 'submitting', 'polling', 'confirmed', 'failed', 'pending', 'submitted'],
    },
    onRetry: { action: 'onRetry' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Building: Story = {
  args: { status: 'building' },
};

export const Signing: Story = {
  args: { status: 'signing' },
};

export const Submitting: Story = {
  args: { status: 'submitting' },
};

export const Polling: Story = {
  args: { status: 'polling' },
};

export const Confirmed: Story = {
  args: {
    status: 'confirmed',
    txHash: 'abc123def456789012345678901234567890abcdef1234567890abcdef12345678',
  },
};

export const Failed: Story = {
  args: {
    status: 'failed',
    message: 'Insufficient funds for transaction',
    onRetry: () => console.log('Retry clicked'),
  },
};

export const FailedWithTxHash: Story = {
  args: {
    status: 'failed',
    txHash: 'abc123def456789012345678901234567890abcdef1234567890abcdef12345678',
    message: 'Transaction expired on network',
    onRetry: () => console.log('Retry clicked'),
  },
};

export const Pending: Story = {
  args: { status: 'pending' },
};

export const Submitted: Story = {
  args: { status: 'submitted' },
};
