import type { Meta, StoryObj } from '@storybook/react';
import LoadingSkeleton from '../LoadingSkeleton';

const meta: Meta<typeof LoadingSkeleton> = {
  title: 'Components/LoadingSkeleton',
  component: LoadingSkeleton,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const CreditCard: Story = {
  args: {
    variant: 'CreditCard',
    count: 1,
  },
};

export const MultipleCreditCards: Story = {
  args: {
    variant: 'CreditCard',
    count: 3,
  },
};

export const MarketplaceItem: Story = {
  args: {
    variant: 'MarketplaceItem',
    count: 1,
  },
};

export const MultipleMarketplaceItems: Story = {
  args: {
    variant: 'MarketplaceItem',
    count: 5,
  },
};

export const PoolStats: Story = {
  args: {
    variant: 'PoolStats',
    count: 1,
  },
};

export const MultiplePoolStats: Story = {
  args: {
    variant: 'PoolStats',
    count: 4,
  },
};