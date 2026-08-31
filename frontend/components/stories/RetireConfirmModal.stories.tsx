import type { Meta, StoryObj } from '@storybook/react';
import RetireConfirmModal from '../RetireConfirmModal';
import { userEvent, within, expect } from '@storybook/test';

const meta: Meta<typeof RetireConfirmModal> = {
  title: 'Components/RetireConfirmModal',
  component: RetireConfirmModal,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    onConfirm: { action: 'onConfirm' },
    onCancel: { action: 'onCancel' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    amount: 500,
    beneficiary: 'Acme Corporation',
    reason: 'Annual sustainability report offset',
    projectName: 'Amazon Rainforest Protection',
    vintageYear: 2023,
    onConfirm: () => console.log('Confirmed'),
    onCancel: () => console.log('Cancelled'),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cancelBtn = canvas.getByRole('button', { name: /cancel/i });
    await expect(cancelBtn).toBeInTheDocument();
    await userEvent.hover(cancelBtn);
  },
};

export const WithoutOptionalFields: Story = {
  args: {
    amount: 100,
    beneficiary: 'Green Tech Inc.',
    reason: 'Voluntary offset',
    onConfirm: () => console.log('Confirmed'),
    onCancel: () => console.log('Cancelled'),
  },
};

export const LargeAmount: Story = {
  args: {
    amount: 10000,
    beneficiary: 'Global Sustainability Initiative',
    reason: 'Carbon neutrality goal 2024',
    projectName: 'Kenya Reforestation Initiative',
    vintageYear: 2024,
    onConfirm: () => console.log('Confirmed'),
    onCancel: () => console.log('Cancelled'),
  },
};

export const KeyboardNavigation: Story = {
  args: {
    amount: 50,
    beneficiary: 'Test Corp',
    reason: 'Test retirement',
    onConfirm: () => console.log('Confirmed'),
    onCancel: () => console.log('Cancelled'),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Tab should focus Cancel button first
    await userEvent.tab();
    const cancelBtn = canvas.getByRole('button', { name: /cancel/i });
    await expect(cancelBtn).toHaveFocus();
    // Tab again to Confirm
    await userEvent.tab();
    const confirmBtn = canvas.getByTestId('confirm-retire-btn');
    await expect(confirmBtn).toHaveFocus();
    // Escape should close
    await userEvent.keyboard('{Escape}');
  },
};
