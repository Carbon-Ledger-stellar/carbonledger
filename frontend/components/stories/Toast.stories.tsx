import type { Meta, StoryObj } from '@storybook/react';
import Toast, { ToastMessage } from '../Toast';

const meta: Meta<typeof Toast> = {
  title: 'Components/Toast',
  component: Toast,
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    onDismiss: { action: 'onDismiss' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleToasts: ToastMessage[] = [
  {
    id: '1',
    type: 'success',
    title: 'Transaction Successful',
    message: 'Your carbon credits have been purchased successfully.',
    txHash: 'abc123def456',
  },
];

export const Success: Story = {
  args: {
    toasts: sampleToasts,
    onDismiss: (id) => console.log('Dismiss', id),
  },
};

export const Error: Story = {
  args: {
    toasts: [
      {
        id: '2',
        type: 'error',
        title: 'Transaction Failed',
        message: 'Insufficient funds for this purchase.',
      },
    ],
    onDismiss: (id) => console.log('Dismiss', id),
  },
};

export const Warning: Story = {
  args: {
    toasts: [
      {
        id: '3',
        type: 'warning',
        title: 'Network Congestion',
        message: 'Transaction may take longer than usual.',
      },
    ],
    onDismiss: (id) => console.log('Dismiss', id),
  },
};

export const Info: Story = {
  args: {
    toasts: [
      {
        id: '4',
        type: 'info',
        title: 'New Feature Available',
        message: 'Bulk retirement is now available in your dashboard.',
      },
    ],
    onDismiss: (id) => console.log('Dismiss', id),
  },
};

export const MultipleToasts: Story = {
  args: {
    toasts: [
      {
        id: '1',
        type: 'success',
        title: 'Credits Retired',
        message: '100 tonnes permanently retired.',
        txHash: 'abc123def456',
      },
      {
        id: '2',
        type: 'warning',
        title: 'Price Alert',
        message: 'Carbon prices have increased by 15%.',
      },
      {
        id: '3',
        type: 'info',
        title: 'Verification Complete',
        message: 'Your project has been verified by Gold Standard.',
      },
    ],
    onDismiss: (id) => console.log('Dismiss', id),
  },
};

export const WithLongMessage: Story = {
  args: {
    toasts: [
      {
        id: '5',
        type: 'success',
        title: 'Bulk Retirement Successful',
        message: 'You have successfully retired 500 tonnes of carbon credits across 3 different projects. This retirement contributes to your company\'s net-zero goals and will be reflected in your next sustainability report.',
        txHash: 'longtransactionhash123456789',
      },
    ],
    onDismiss: (id) => console.log('Dismiss', id),
  },
};