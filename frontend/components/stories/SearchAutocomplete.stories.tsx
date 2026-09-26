import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import SearchAutocomplete from '../SearchAutocomplete';

const SUGGESTIONS = [
  'Amazon Reforestation',
  'Kenya Solar Farm',
  'Amazon Blue Carbon Mangroves',
  'Peru Agroforestry Collective',
  'India Wind Power Initiative',
  'Indonesia Direct Air Capture',
  'Colombia Methane Capture',
  'Brazil Forest Conservation',
];

function Controlled() {
  const [value, setValue] = useState('');
  return (
    <div style={{ maxWidth: '360px' }}>
      <SearchAutocomplete
        id="story-search"
        value={value}
        onChange={setValue}
        suggestions={SUGGESTIONS}
        placeholder="Search by project name…"
        ariaLabel="Search projects"
        inputStyle={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '0.6rem 0.9rem',
          fontSize: '0.9rem',
          border: '1px solid #d4d4d4',
          borderRadius: '0.5rem',
        }}
      />
    </div>
  );
}

const meta: Meta<typeof Controlled> = {
  title: 'Components/SearchAutocomplete',
  component: Controlled,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <Controlled />,
};
