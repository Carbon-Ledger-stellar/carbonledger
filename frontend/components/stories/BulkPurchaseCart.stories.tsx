import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within, expect } from '@storybook/test';
import BulkPurchaseCart from '../BulkPurchaseCart';
import { useCartStore } from '../../lib/use-cart-store';

const meta: Meta<typeof BulkPurchaseCart> = {
  title: 'Components/BulkPurchaseCart',
  component: BulkPurchaseCart,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

const sampleListing = {
  id: '1',
  listingId: 'list-001',
  projectId: 'proj-001',
  projectName: 'Amazon Rainforest Protection',
  batchId: 'batch-001',
  seller: 'seller-address',
  amountAvailable: 1000,
  pricePerCredit: '25000000',
  vintageYear: 2023,
  methodology: 'VCS',
  country: 'Brazil',
  status: 'Active',
  createdAt: '2024-01-01T00:00:00Z',
};

export const Empty: Story = {
  decorators: [
    (Story) => {
      useCartStore.getState().clearCart();
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Add credits from the marketplace/i)).toBeInTheDocument();
  },
};

export const WithItems: Story = {
  decorators: [
    (Story) => {
      const store = useCartStore.getState();
      store.clearCart();
      store.addItem(sampleListing, 100);
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Amazon Rainforest Protection/)).toBeInTheDocument();
    await expect(canvas.getByText(/1 project/)).toBeInTheDocument();
  },
};

export const MultipleItems: Story = {
  decorators: [
    (Story) => {
      const store = useCartStore.getState();
      store.clearCart();
      store.addItem(sampleListing, 100);
      store.addItem({
        ...sampleListing,
        listingId: 'list-002',
        projectName: 'Kenya Reforestation',
        methodology: 'Gold Standard',
      }, 200);
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/2 projects/)).toBeInTheDocument();
  },
};
