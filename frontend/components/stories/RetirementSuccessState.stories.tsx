import type { Meta, StoryObj } from '@storybook/react';
import RetirementSuccessState from '../RetirementSuccessState';
import { RetirementRecord } from '../../lib/api';

const meta: Meta<typeof RetirementSuccessState> = {
  title: 'Components/RetirementSuccessState',
  component: RetirementSuccessState,
  parameters: { layout: 'padded' },
  argTypes: {
    onDownload: { action: 'onDownload' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleRetirement: RetirementRecord = {
  id: 'ret-1',
  retirementId: 'ret-001',
  batchId: 'batch-001',
  projectId: 'proj-001',
  amount: 500,
  retiredBy: '0xABC123',
  beneficiary: 'Acme Corporation',
  retirementReason: 'Annual sustainability report offset',
  vintageYear: 2023,
  serialNumbers: ['SN-001', 'SN-002'],
  retiredAt: '2024-06-15T10:30:00Z',
  txHash: 'abc123def45678901234567890abcdef1234567890abcdef',
  project: { name: 'Amazon Rainforest Protection', methodology: 'VCS', country: 'Brazil' },
  batch: { batchId: 'batch-001', status: 'retired' },
};

export const Default: Story = {
  args: {
    retirement: sampleRetirement,
    onDownload: () => console.log('Download PDF'),
  },
};

export const SmallAmount: Story = {
  args: {
    retirement: { ...sampleRetirement, amount: 0.5, retirementId: 'ret-002' },
    onDownload: () => console.log('Download PDF'),
  },
};

export const LargeAmount: Story = {
  args: {
    retirement: { ...sampleRetirement, amount: 10000, retirementId: 'ret-003', beneficiary: 'Global Sustainability Initiative' },
    onDownload: () => console.log('Download PDF'),
  },
};
