import type { Meta, StoryObj } from '@storybook/react';
import AuditExplorer from '../AuditExplorer';

const meta: Meta<typeof AuditExplorer> = {
  title: 'Components/AuditExplorer',
  component: AuditExplorer,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
