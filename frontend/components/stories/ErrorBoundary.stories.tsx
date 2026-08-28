import type { Meta, StoryObj } from '@storybook/react';
import ErrorBoundary from '../ErrorBoundary';

const meta: Meta<typeof ErrorBoundary> = {
  title: 'Components/ErrorBoundary',
  component: ErrorBoundary,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

function ThrowingComponent() {
  throw new Error('Component render failed');
}

function WorkingComponent() {
  return <div style={{ padding: '1rem', background: '#f0fdf4', borderRadius: '0.5rem' }}>Component renders successfully!</div>;
}

export const NoError: Story = {
  args: {
    children: <WorkingComponent />,
  },
};

export const WithError: Story = {
  args: {
    children: <ThrowingComponent />,
  },
};

export const WithCustomFallback: Story = {
  args: {
    children: <ThrowingComponent />,
    fallback: <div style={{ padding: '2rem', textAlign: 'center', color: '#dc2626' }}>Custom error boundary fallback</div>,
  },
};

export const DevMode: Story = {
  args: {
    children: <ThrowingComponent />,
    devMode: true,
  },
};
