import type { Meta, StoryObj } from '@storybook/react';
import CreditCard from '../CreditCard';
import { MarketListing } from '../../lib/api';

const meta: Meta<typeof CreditCard> = {
  title: 'Components/CreditCard',
  component: CreditCard,
  parameters: {
    layout: 'padded',
  },
  argTypes: {
    onAddToCart: { action: 'onAddToCart' },
    onBuyNow: { action: 'onBuyNow' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleListing: MarketListing = {
  id: '1',
  listingId: 'list-001',
  projectId: 'proj-001',
  projectName: 'Amazon Rainforest Protection',
  batchId: 'batch-001',
  seller: 'seller-address',
  amountAvailable: 1000,
  pricePerCredit: '25000000', // 25 USDC in stroops
  vintageYear: 2023,
  methodology: 'VCS',
  country: 'Brazil',
  status: 'Active',
  oracleDaysSinceUpdate: 150,
  createdAt: '2024-01-01T00:00:00Z',
};

export const Active: Story = {
  args: {
    listing: sampleListing,
    onAddToCart: (listing) => console.log('Add to Cart', listing),
    onBuyNow: (listing) => console.log('Buy Now', listing),
  },
};

export const Delisted: Story = {
  args: {
    listing: {
      ...sampleListing,
      status: 'Delisted',
    },
  },
};

export const StaleOracle: Story = {
  args: {
    listing: {
      ...sampleListing,
      oracleDaysSinceUpdate: 350,
    },
    onAddToCart: (listing) => console.log('Add to Cart', listing),
    onBuyNow: (listing) => console.log('Buy Now', listing),
  },
};

export const GoldStandard: Story = {
  args: {
    listing: {
      ...sampleListing,
      methodology: 'Gold Standard',
    },
  },
};

export const ACR: Story = {
  args: {
    listing: {
      ...sampleListing,
      methodology: 'ACR',
    },
  },
};

export const CAR: Story = {
  args: {
    listing: {
      ...sampleListing,
      methodology: 'CAR',
    },
  },
};

export const HighPrice: Story = {
  args: {
    listing: {
      ...sampleListing,
      pricePerCredit: '100000000', // 100 USDC
    },
  },
};

export const LowAvailability: Story = {
  args: {
    listing: {
      ...sampleListing,
      amountAvailable: 50,
    },
  },
};

export const DifferentCountry: Story = {
  args: {
    listing: {
      ...sampleListing,
      country: 'Kenya',
      projectName: 'African Reforestation Initiative',
    },
  },
};