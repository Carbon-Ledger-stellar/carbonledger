import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within, expect } from '@storybook/test';
import MarketplaceFilter, { FilterState, EMPTY_FILTERS } from '../MarketplaceFilter';

const meta: Meta<typeof MarketplaceFilter> = {
  title: 'Components/MarketplaceFilter',
  component: MarketplaceFilter,
  parameters: { layout: 'padded' },
  argTypes: {
    onChange: { action: 'onChange' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    filters: EMPTY_FILTERS,
    onChange: (f: FilterState) => console.log('Filters changed:', f),
    resultCount: 42,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText(/search credits/i)).toBeInTheDocument();
    await expect(canvas.getByLabelText(/filter by methodology/i)).toBeInTheDocument();
  },
};

export const WithActiveFilters: Story = {
  args: {
    filters: {
      methodology: 'VCS',
      vintageYear: '2023',
      country: 'Brazil',
      minPrice: '',
      maxPrice: '50',
      projectType: '',
      search: '',
      availableOnly: '',
    },
    onChange: (f: FilterState) => console.log('Filters changed:', f),
    resultCount: 12,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const methodologySelect = canvas.getByLabelText(/filter by methodology/i);
    await expect(methodologySelect).toHaveValue('VCS');
  },
};

export const WithSearch: Story = {
  args: {
    filters: {
      ...EMPTY_FILTERS,
      search: 'rainforest',
    },
    onChange: (f: FilterState) => console.log('Filters changed:', f),
    resultCount: 5,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const searchInput = canvas.getByLabelText(/search credits/i);
    await expect(searchInput).toHaveValue('rainforest');
  },
};

export const Interaction: Story = {
  args: {
    filters: EMPTY_FILTERS,
    onChange: (f: FilterState) => console.log('Filters changed:', f),
    resultCount: 42,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Type in search
    const searchInput = canvas.getByLabelText(/search credits/i);
    await userEvent.type(searchInput, 'carbon');
    // Change methodology
    const methodologySelect = canvas.getByLabelText(/filter by methodology/i);
    await userEvent.selectOptions(methodologySelect, 'VCS');
    // Check available only
    const availableCheckbox = canvas.getByLabelText(/show only credits available now/i);
    await userEvent.click(availableCheckbox);
  },
};
