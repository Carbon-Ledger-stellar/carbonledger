import type { Meta, StoryObj } from '@storybook/react';
import ProvenanceTrail from '../ProvenanceTrail';

const meta: Meta<typeof ProvenanceTrail> = {
  title: 'Components/ProvenanceTrail',
  component: ProvenanceTrail,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleEvents = [
  {
    type: 'registered' as const,
    label: 'Project Registered',
    timestamp: '2023-06-01T00:00:00Z',
    actor: 'project-developer',
    txHash: 'reg-tx-123',
    detail: 'Amazon Rainforest Protection project registered on CarbonLedger',
  },
  {
    type: 'verified' as const,
    label: 'Project Verified',
    timestamp: '2023-07-15T00:00:00Z',
    actor: 'verifier-org',
    txHash: 'ver-tx-456',
    detail: 'Verified by Gold Standard methodology requirements',
  },
  {
    type: 'minted' as const,
    label: 'Credits Minted',
    timestamp: '2023-08-01T00:00:00Z',
    txHash: 'mint-tx-789',
    detail: '1,000 tonnes of carbon credits minted',
  },
  {
    type: 'listed' as const,
    label: 'Credits Listed',
    timestamp: '2023-08-15T00:00:00Z',
    actor: 'seller-address',
    txHash: 'list-tx-101',
    detail: 'Listed 500 tonnes at $25/USDC per tonne',
  },
  {
    type: 'purchased' as const,
    label: 'Credits Purchased',
    timestamp: '2023-09-01T00:00:00Z',
    actor: 'buyer-address',
    txHash: 'buy-tx-202',
    detail: '200 tonnes purchased by Green Corp Inc.',
  },
  {
    type: 'retired' as const,
    label: 'Credits Retired',
    timestamp: '2023-09-15T00:00:00Z',
    actor: 'retirement-beneficiary',
    txHash: 'ret-tx-303',
    detail: '200 tonnes permanently retired for corporate ESG goals',
  },
];

export const Populated: Story = {
  args: {
    events: sampleEvents,
  },
};

export const PartialTrail: Story = {
  args: {
    events: sampleEvents.slice(0, 3),
  },
};

export const SingleEvent: Story = {
  args: {
    events: [sampleEvents[0]],
  },
};

export const Empty: Story = {
  args: {
    events: [],
  },
};

export const RecentEvents: Story = {
  args: {
    events: sampleEvents.map(event => ({
      ...event,
      timestamp: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
    })),
  },
};

export const LongDetails: Story = {
  args: {
    events: [
      {
        type: 'retired' as const,
        label: 'Large Scale Retirement',
        timestamp: '2024-01-01T00:00:00Z',
        actor: 'major-corporation',
        txHash: 'ret-tx-long-123456789',
        detail: '10,000 tonnes of carbon credits permanently retired as part of the company\'s commitment to achieve net-zero emissions by 2050, covering Scope 1, 2, and 3 emissions across global operations.',
      },
    ],
  },
};