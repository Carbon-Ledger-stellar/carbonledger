import type { Meta, StoryObj } from '@storybook/react';
import Highlight from '../Highlight';

const meta: Meta<typeof Highlight> = {
  title: 'Components/Highlight',
  component: Highlight,
  parameters: { layout: 'padded' },
  argTypes: {
    text: { control: 'text' },
    query: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    text: 'Amazon Rainforest Protection Project',
    query: 'Rainforest',
  },
};

export const NoMatch: Story = {
  args: {
    text: 'Amazon Rainforest Protection Project',
    query: 'Ocean',
  },
};

export const EmptyQuery: Story = {
  args: {
    text: 'Amazon Rainforest Protection Project',
    query: '',
  },
};

export const CaseInsensitive: Story = {
  args: {
    text: 'VCS Methodology Verified Credits',
    query: 'vcs',
  },
};

export const MultipleMatches: Story = {
  args: {
    text: 'Carbon credits from the carbon registry for carbon offset projects',
    query: 'carbon',
  },
};
