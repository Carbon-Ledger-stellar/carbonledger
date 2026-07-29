import type { Meta, StoryObj } from '@storybook/react';
import EsgPieChart from '../EsgPieChart';
import { PieChartData } from '../../lib/esg-aggregation';

const meta: Meta<typeof EsgPieChart> = {
  title: 'Components/EsgPieChart',
  component: EsgPieChart,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleData: PieChartData[] = [
  { name: 'VCS', value: 900 },
  { name: 'Gold Standard', value: 400 },
  { name: 'ACR', value: 180 },
  { name: 'CAR', value: 60 },
  { name: 'Plan Vivo', value: 15 },
];

export const Populated: Story = {
  args: { data: sampleData },
};

export const Empty: Story = {
  args: { data: [] },
};

export const SingleMethodology: Story = {
  args: { data: [{ name: 'VCS', value: 1000 }] },
};

export const TwoMethodologies: Story = {
  args: { data: [{ name: 'VCS', value: 700 }, { name: 'Gold Standard', value: 300 }] },
};
