import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@/lib/theme-context';
import Navbar from '../Navbar';
import esMessages from '../../public/locales/es/common.json';
import { setTestLocaleMessages } from 'next-intl';

jest.mock('next-intl');

const mockUsePathname = jest.fn<string, []>();
jest.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

jest.mock('next/link', () =>
  function MockLink({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return <a href={href} {...rest}>{children}</a>;
  }
);

jest.mock('@/lib/wallet/WalletContext', () => ({
  useWallet: () => ({
    isConnected: false,
    publicKey: null,
    error: null,
    connect: jest.fn(),
    disconnect: jest.fn(),
    checkNetwork: jest.fn().mockResolvedValue({ isCorrect: true, currentNetwork: 'testnet' }),
  }),
}));

jest.mock('@/components/LocaleProvider', () => ({
  useAppLocale: () => ({ locale: 'es', setLocale: jest.fn() }),
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
});

function renderNavbar() {
  mockUsePathname.mockReturnValue('/marketplace');
  setTestLocaleMessages(esMessages);
  return render(
    <ThemeProvider>
      <Navbar />
    </ThemeProvider>
  );
}

describe('i18n Navbar locale strings', () => {
  it('renders Spanish nav labels when locale messages are es', () => {
    renderNavbar();

    expect(screen.getAllByRole('link', { name: 'Mercado' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Proyectos' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Conectar billetera' }).length).toBeGreaterThan(0);
  });
});
