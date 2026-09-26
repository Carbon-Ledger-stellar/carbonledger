import type { Meta, StoryObj } from '@storybook/react';
import EsgDateRangeFilter from '../EsgDateRangeFilter';

const meta: Meta<typeof EsgDateRangeFilter> = {
  title: 'Components/EsgDateRangeFilter',
  component: EsgDateRangeFilter,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    onStartChange: (v: string) => console.log('Start:', v),
    onEndChange: (v: string) => console.log('End:', v),
    onReset: () => console.log('Reset'),
  },
};

export const CustomRange: Story = {
  args: {
    startDate: '2023-06-01',
    endDate: '2025-01-15',
    onStartChange: (v: string) => console.log('Start:', v),
    onEndChange: (v: string) => console.log('End:', v),
    onReset: () => console.log('Reset'),
  },
};

export const EmptyRange: Story = {
  args: {
    startDate: '',
    endDate: '',
    onStartChange: (v: string) => console.log('Start:', v),
    onEndChange: (v: string) => console.log('End:', v),
    onReset: () => console.log('Reset'),
  },
};
