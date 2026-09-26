import type { Meta, StoryObj } from '@storybook/react';
import Tooltip from '../Tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'Components/Tooltip',
  component: Tooltip,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    content: 'This is a helpful tooltip',
    children: <span style={{ cursor: 'pointer', padding: '8px 16px', background: '#f3f4f6', borderRadius: '4px' }}>Hover me</span>,
  },
};

export const LongContent: Story = {
  args: {
    content: 'VCS (Verified Carbon Standard) is the world\'s most widely used voluntary greenhouse gas reduction program.',
    children: <span style={{ cursor: 'pointer', padding: '8px 16px', background: '#f3f4f6', borderRadius: '4px' }}>VCS Info</span>,
  },
};

export const MultiLine: Story = {
  args: {
    content: 'Healthy — monitoring data is within the last 365 days.\nNew credit issuance is not affected.',
    children: <span style={{ cursor: 'pointer', padding: '8px 16px', background: '#16a34a', color: '#fff', borderRadius: '4px' }}>Oracle Status</span>,
  },
};

export const Disabled: Story = {
  args: {
    content: 'This feature is coming soon',
    children: <span style={{ cursor: 'not-allowed', padding: '8px 16px', background: '#e5e7eb', color: '#9ca3af', borderRadius: '4px', opacity: 0.6 }}>Disabled Button</span>,
  },
};
