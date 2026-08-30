import type { Meta, StoryObj } from '@storybook/react';
import LazyImage from '../LazyImage';

const meta: Meta<typeof LazyImage> = {
  title: 'Components/LazyImage',
  component: LazyImage,
  parameters: { layout: 'padded' },
  argTypes: {
    src: { control: 'text' },
    alt: { control: 'text' },
    width: { control: 'number' },
    height: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    src: '/images/project-types/tree.svg',
    alt: 'Reforestation project',
    width: 96,
    height: 96,
  },
};

export const Circular: Story = {
  args: {
    src: '/images/project-types/turbine.svg',
    alt: 'Renewable energy project',
    width: 64,
    height: 64,
    borderRadius: '9999px',
  },
};

export const BrokenImage: Story = {
  args: {
    src: '/images/does-not-exist.svg',
    alt: 'Missing image',
    width: 96,
    height: 96,
  },
};

/** A grid of many lazy images — scroll the parent to see each one fetch in as it enters view. */
export const Grid: Story = {
  render: () => (
    <div style={{ height: '260px', overflowY: 'auto', border: '1px dashed #d4d4d4', padding: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '1rem' }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <LazyImage
            key={i}
            src={['/images/project-types/tree.svg', '/images/project-types/turbine.svg', '/images/project-types/factory.svg', '/images/project-types/wave.svg'][i % 4]}
            alt={`Project ${i + 1}`}
            width={64}
            height={64}
            borderRadius="9999px"
          />
        ))}
      </div>
    </div>
  ),
};
