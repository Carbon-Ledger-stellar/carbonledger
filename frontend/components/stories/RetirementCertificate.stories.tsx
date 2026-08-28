import type { Meta, StoryObj } from '@storybook/react';
import RetirementCertificate from '../RetirementCertificate';
import { RetirementRecord } from '../../lib/api';

const meta: Meta<typeof RetirementCertificate> = {
  title: 'Components/RetirementCertificate',
  component: RetirementCertificate,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleRetirement: RetirementRecord = {
  id: '1',
  retirementId: 'ret-001',
  batchId: 'batch-001',
  projectId: 'proj-001',
  amount: 100,
  retiredBy: 'user-address',
  beneficiary: 'Green Corp Inc.',
  retirementReason: 'Corporate ESG Initiative',
  vintageYear: 2023,
  serialNumbers: ['CARB-001-0001', 'CARB-001-0100'],
  txHash: 'stellar-tx-hash-123456789',
  retiredAt: '2024-01-15T10:30:00Z',
};

export const Populated: Story = {
  args: {
    retirement: sampleRetirement,
    publicUrl: 'https://carbonledger.com/retire/ret-001',
  },
};

export const LargeAmount: Story = {
  args: {
    retirement: {
      ...sampleRetirement,
      amount: 10000,
      beneficiary: 'Global Climate Fund',
      retirementReason: 'International Climate Agreement',
    },
  },
};

export const SmallAmount: Story = {
  args: {
    retirement: {
      ...sampleRetirement,
      amount: 1,
      beneficiary: 'Individual Contributor',
      retirementReason: 'Personal Carbon Offset',
    },
  },
};

export const DifferentBeneficiary: Story = {
  args: {
    retirement: {
      ...sampleRetirement,
      beneficiary: 'United Nations Framework Convention on Climate Change',
      retirementReason: 'Paris Agreement Compliance',
    },
  },
};

export const RecentRetirement: Story = {
  args: {
    retirement: {
      ...sampleRetirement,
      retiredAt: new Date().toISOString(),
    },
  },
};

export const LongSerialRange: Story = {
  args: {
    retirement: {
      ...sampleRetirement,
      serialNumbers: ['CARB-001-000001', 'CARB-001-999999'],
      amount: 999999,
    },
  },
};