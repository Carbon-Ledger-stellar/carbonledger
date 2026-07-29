import type { Meta, StoryObj } from '@storybook/react';
import LoadingSkeleton from '../LoadingSkeleton';

const meta: Meta<typeof LoadingSkeleton> = {
  title: 'Components/LoadingSkeleton',
  component: LoadingSkeleton,
  parameters: { layout: 'padded' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['CreditCard', 'MarketplaceItem', 'PoolStats', 'ProjectCard', 'ProvenanceTrail', 'Certificate', 'AuditItem'],
    },
    count: { control: { type: 'range', min: 1, max: 5, step: 1 } },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const CreditCard: Story = {
  args: { variant: 'CreditCard', count: 1 },
};

export const MultipleCreditCards: Story = {
  args: { variant: 'CreditCard', count: 3 },
};

export const MarketplaceItem: Story = {
  args: { variant: 'MarketplaceItem', count: 1 },
};

export const MultipleMarketplaceItems: Story = {
  args: { variant: 'MarketplaceItem', count: 5 },
};

export const PoolStats: Story = {
  args: { variant: 'PoolStats', count: 1 },
};

export const MultiplePoolStats: Story = {
  args: { variant: 'PoolStats', count: 3 },
};

export const ProjectCard: Story = {
  args: { variant: 'ProjectCard', count: 1 },
};

export const ProvenanceTrail: Story = {
  args: { variant: 'ProvenanceTrail', count: 1 },
};

export const Certificate: Story = {
  args: { variant: 'Certificate', count: 1 },
};

export const AuditItem: Story = {
  args: { variant: 'AuditItem', count: 3 },
};
