import type { Meta, StoryObj } from '@storybook/react';
import EsgKpiCards from '../EsgKpiCards';
import { KpiData } from '../../lib/esg-aggregation';

const meta: Meta<typeof EsgKpiCards> = {
  title: 'Components/EsgKpiCards',
  component: EsgKpiCards,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    kpi: {
      totalTonnesLifetime: 12500,
      totalTonnesThisYear: 3200,
      pendingCertificates: 15,
    },
  },
};

export const HighValues: Story = {
  args: {
    kpi: {
      totalTonnesLifetime: 2500000,
      totalTonnesThisYear: 850000,
      pendingCertificates: 42,
    },
  },
};

export const ZeroValues: Story = {
  args: {
    kpi: {
      totalTonnesLifetime: 0,
      totalTonnesThisYear: 0,
      pendingCertificates: 0,
    },
  },
};
