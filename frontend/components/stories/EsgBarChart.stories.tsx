import type { Meta, StoryObj } from '@storybook/react';
import EsgBarChart from '../EsgBarChart';
import { BarChartData } from '../../lib/esg-aggregation';

const meta: Meta<typeof EsgBarChart> = {
  title: 'Components/EsgBarChart',
  component: EsgBarChart,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleData: BarChartData[] = [
  { year: '2022', VCS: 150, 'Gold Standard': 80, ACR: 30 },
  { year: '2023', VCS: 300, 'Gold Standard': 120, ACR: 60, CAR: 20 },
  { year: '2024', VCS: 450, 'Gold Standard': 200, ACR: 90, CAR: 40, 'Plan Vivo': 15 },
];

export const Populated: Story = {
  args: {
    data: sampleData,
    methodologies: ['VCS', 'Gold Standard', 'ACR', 'CAR', 'Plan Vivo'],
  },
};

export const Empty: Story = {
  args: {
    data: [],
    methodologies: [],
  },
};

export const SingleYear: Story = {
  args: {
    data: [{ year: '2024', VCS: 500, 'Gold Standard': 200 }],
    methodologies: ['VCS', 'Gold Standard'],
  },
};
