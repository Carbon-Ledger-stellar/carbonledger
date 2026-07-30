import type { Meta, StoryObj } from '@storybook/react';
import OracleHistory from '../OracleHistory';

const meta: Meta<typeof OracleHistory> = {
  title: 'Components/OracleHistory',
  component: OracleHistory,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WithData: Story = {
  args: {
    projectId: 'proj-001',
  },
};

export const Loading: Story = {
  args: {
    projectId: 'proj-loading',
  },
};
