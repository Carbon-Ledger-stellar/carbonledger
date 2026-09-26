import type { Meta, StoryObj } from '@storybook/react';
import WalletPrompt from '../WalletPrompt';
import { WalletStatus } from '../../hooks/useWalletStatus';

const meta: Meta<typeof WalletPrompt> = {
  title: 'Components/WalletPrompt',
  component: WalletPrompt,
  parameters: { layout: 'padded' },
  argTypes: {
    onConnect: { action: 'onConnect' },
    refresh: { action: 'refresh' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const NotInstalled: Story = {
  args: {
    status: 'not_installed' as WalletStatus,
    onConnect: () => {},
    refresh: () => {},
  },
};

export const NotConnected: Story = {
  args: {
    status: 'not_connected' as WalletStatus,
    onConnect: (addr: string) => console.log('Connected:', addr),
    refresh: () => {},
  },
};

export const WrongNetwork: Story = {
  args: {
    status: 'wrong_network' as WalletStatus,
    onConnect: () => {},
    refresh: () => console.log('Refresh clicked'),
  },
};

export const Loading: Story = {
  args: {
    status: 'loading' as WalletStatus,
    onConnect: () => {},
    refresh: () => {},
  },
};

export const Ready: Story = {
  args: {
    status: 'ready' as WalletStatus,
    onConnect: () => {},
    refresh: () => {},
  },
};
