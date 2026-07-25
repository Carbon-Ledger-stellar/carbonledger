import type { Meta, StoryObj } from '@storybook/react';
import ProjectMap from '../ProjectMap';
import { MapPin } from '../../lib/map-utils';

const meta: Meta<typeof ProjectMap> = {
  title: 'Components/ProjectMap',
  component: ProjectMap,
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const samplePins: MapPin[] = [
  {
    listingId: 'list-001',
    projectId: 'proj-001',
    projectName: 'Amazon Rainforest Protection',
    lat: -3.4653,
    lng: -62.2159,
    vintageYear: 2023,
    methodologyScore: 92,
    amountAvailable: 1000,
    projectType: 'REDD+',
    methodology: 'VCS',
    country: 'Brazil',
  },
  {
    listingId: 'list-002',
    projectId: 'proj-002',
    projectName: 'Sundarbans Mangrove Restoration',
    lat: 21.9497,
    lng: 89.1833,
    vintageYear: 2022,
    methodologyScore: 88,
    amountAvailable: 400,
    projectType: 'Blue Carbon',
    methodology: 'Gold Standard',
    country: 'India',
  },
  {
    listingId: 'list-003',
    projectId: 'proj-003',
    projectName: 'Kenyan Clean Cookstove Initiative',
    lat: -1.2921,
    lng: 36.8219,
    vintageYear: 2024,
    methodologyScore: 79,
    amountAvailable: 2500,
    projectType: 'Improved Cookstoves',
    methodology: 'ACR',
    country: 'Kenya',
  },
];

// Several pins clustered close together (same general area, small offsets)
// so they collapse into a single cluster marker until zoomed in.
const clusteredPins: MapPin[] = [
  ...samplePins,
  { ...samplePins[0], listingId: 'list-004', projectId: 'proj-004', projectName: 'Rondônia Forest Corridor', lat: -3.48, lng: -62.22 },
  { ...samplePins[0], listingId: 'list-005', projectId: 'proj-005', projectName: 'Acre Basin Conservation', lat: -3.5, lng: -62.19 },
  { ...samplePins[0], listingId: 'list-006', projectId: 'proj-006', projectName: 'Xingu Watershed Reserve', lat: -3.44, lng: -62.24 },
];

export const EmptyState: Story = {
  args: {
    pins: [],
  },
};

export const SingleProject: Story = {
  args: {
    pins: [samplePins[0]],
  },
};

export const ClusteredProjects: Story = {
  args: {
    pins: clusteredPins,
  },
};

export const FilteredView: Story = {
  name: 'Filtered view (Blue Carbon only)',
  args: {
    pins: samplePins.filter((p) => p.projectType === 'Blue Carbon'),
  },
};
