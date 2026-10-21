import type { Meta, StoryObj } from '@storybook/react';
import { EsgBarChart } from './EsgBarChart';

const meta: Meta<typeof EsgBarChart> = {
  title: 'ESG/EsgBarChart',
  component: EsgBarChart,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;

type Story = StoryObj<typeof EsgBarChart>;

const mockData = [
  { label: 'Jan', value: 42 },
  { label: 'Feb', value: 58 },
  { label: 'Mar', value: 35 },
  { label: 'Apr', value: 71 },
  { label: 'May', value: 64 },
  { label: 'Jun', value: 89 },
];

export const Default: Story = {
  args: {
    data: mockData,
    loading: false,
  },
};

export const Empty: Story = {
  args: {
    data: [],
    loading: false,
  },
};

export const Loading: Story = {
  args: {
    data: [],
    loading: true,
  },
};
