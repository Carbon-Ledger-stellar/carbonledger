import type { Meta, StoryObj } from '@storybook/react';
import ProjectOracleStatus from '../ProjectOracleStatus';

const meta: Meta<typeof ProjectOracleStatus> = {
  title: 'Components/ProjectOracleStatus',
  component: ProjectOracleStatus,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  args: { projectId: 'proj-active' },
};

export const Inactive: Story = {
  args: { projectId: 'proj-inactive' },
};

export const Loading: Story = {
  args: { projectId: 'proj-loading' },
};
