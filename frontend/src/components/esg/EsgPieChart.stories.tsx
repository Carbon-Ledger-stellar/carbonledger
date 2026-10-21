import type { Meta, StoryObj } from '@storybook/react';
import { EsgPieChart } from './EsgPieChart';

const meta: Meta<typeof EsgPieChart> = {
  title: 'ESG/EsgPieChart',
  component: EsgPieChart,
  parameters: {
    layout: 'centered',
  },
  tags: ['visual-regression'],
};

export default meta;

type Story = StoryObj<typeof EsgPieChart>;

const mockData = [
  { label: 'Environmental', value: 42 },
  { label: 'Social', value: 28 },
  { label: 'Governance', value: 30 },
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
