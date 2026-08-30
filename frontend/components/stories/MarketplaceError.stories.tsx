import type { Meta, StoryObj } from '@storybook/react';
import MarketplaceError from '../MarketplaceError';

const meta: Meta<typeof MarketplaceError> = {
  title: 'Components/MarketplaceError',
  component: MarketplaceError,
  parameters: { layout: 'padded' },
  argTypes: {
    onRetry: { action: 'onRetry' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    error: new Error('Failed to fetch marketplace listings'),
    onRetry: () => console.log('Retry clicked'),
  },
};

export const NetworkError: Story = {
  args: {
    error: new Error('Network request failed'),
    onRetry: () => console.log('Retry clicked'),
  },
};

export const ServerError: Story = {
  args: {
    error: new Error('Internal Server Error'),
    onRetry: () => console.log('Retry clicked'),
  },
};
