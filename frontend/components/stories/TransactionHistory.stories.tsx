import type { Meta, StoryObj } from '@storybook/react';
import TransactionHistory from '../TransactionHistory';

const meta: Meta<typeof TransactionHistory> = {
  title: 'Components/TransactionHistory',
  component: TransactionHistory,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: {
    transactions: [
      { id: '1', date: '2024-01-15', type: 'Purchase', amount: '500 tCO₂e', status: 'Completed', description: 'Amazon Protection Project' },
      { id: '2', date: '2024-01-10', type: 'Retirement', amount: '200 tCO₂e', status: 'Verified', description: 'Forest Conservation' },
      { id: '3', date: '2024-01-05', type: 'Sale', amount: '300 tCO₂e', status: 'Pending', description: 'Carbon Credits Sale' },
    ],
  },
};

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    transactions: [],
  },
};

export const SingleTransaction: Story = {
  args: {
    transactions: [
      { id: '1', date: '2024-06-01', type: 'Purchase', amount: '1000 tCO₂e', status: 'Completed', description: 'Gold Standard Reforestation' },
    ],
  },
};
