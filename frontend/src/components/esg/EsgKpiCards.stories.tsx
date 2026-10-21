import type { Meta, StoryObj } from '@storybook/react';
import { EsgKpiCards } from './EsgKpiCards';

const meta: Meta<typeof EsgKpiCards> = {
  title: 'ESG/EsgKpiCards',
  component: EsgKpiCards,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;

type Story = StoryObj<typeof EsgKpiCards>;

const mockKpis = [
  {
    id: 'total-emissions',
    label: 'Total Emissions',
    value: 12450,
    unit: 'tCO2e',
    change: -8.4,
  },
  {
    id: 'energy-intensity',
    label: 'Energy Intensity',
    value: 3.2,
    unit: 'MWh/$M',
    change: -2.1,
  },
  {
    id: 'renewable-share',
    label: 'Renewable Share',
    value: 62,
    unit: '%',
    change: 5.7,
  },
  {
    id: 'water-usage',
    label: 'Water Usage',
    value: 18400,
    unit: 'm3',
    change: 1.3,
  },
];

export const Default: Story = {
  args: {
    kpis: mockKpis,
    loading: false,
  },
};

export const Empty: Story = {
  args: {
    kpis: [],
    loading: false,
  },
};

export const Loading: Story = {
  args: {
    kpis: [],
    loading: true,
  },
};
