import type { Meta, StoryObj } from '@storybook/react';
import MapFallbackTable from '../MapFallbackTable';
import { MapPin } from '../../lib/map-utils';

const meta: Meta<typeof MapFallbackTable> = {
  title: 'Components/MapFallbackTable',
  component: MapFallbackTable,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

const samplePins: MapPin[] = [
  {
    listingId: 'list-1',
    projectId: 'proj-1',
    projectName: 'Amazon Rainforest Protection',
    projectType: 'REDD+',
    country: 'Brazil',
    vintageYear: 2023,
    methodologyScore: 85,
    amountAvailable: 1000,
    lat: -3.4653,
    lng: -62.2159,
    pricePerCredit: '25000000',
    methodology: 'VCS',
  },
  {
    listingId: 'list-2',
    projectId: 'proj-2',
    projectName: 'Kenya Reforestation Initiative',
    projectType: 'ARR',
    country: 'Kenya',
    vintageYear: 2024,
    methodologyScore: 92,
    amountAvailable: 500,
    lat: -1.2921,
    lng: 36.8219,
    pricePerCredit: '30000000',
    methodology: 'Gold Standard',
  },
  {
    listingId: 'list-3',
    projectId: 'proj-3',
    projectName: 'Indonesia Peatland Conservation',
    projectType: 'REDD+',
    country: 'Indonesia',
    vintageYear: 2022,
    methodologyScore: 78,
    amountAvailable: 250,
    lat: -6.2088,
    lng: 106.8456,
    pricePerCredit: '20000000',
    methodology: 'VCS',
  },
];

export const Populated: Story = {
  args: { pins: samplePins },
};

export const Empty: Story = {
  args: { pins: [] },
};

export const SingleProject: Story = {
  args: { pins: [samplePins[0]] },
};
