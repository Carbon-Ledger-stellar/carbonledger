import type { Meta, StoryObj } from '@storybook/react';
import SerialNumberLookup from '../SerialNumberLookup';

const meta: Meta<typeof SerialNumberLookup> = {
  title: 'Components/SerialNumberLookup',
  component: SerialNumberLookup,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
