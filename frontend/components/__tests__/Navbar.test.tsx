import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// ─── Mock next/navigation ────────────────────────────────────────────────────
const mockUsePathname = jest.fn<string, []>();
jest.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}));

// ─── Mock next/link (renders a plain <a> in tests) ───────────────────────────
jest.mock('next/link', () =>
  function MockLink({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
    return <a href={href} {...rest}>{children}</a>;
  }
);

// ─── Mock WalletContext (not under test here) ─────────────────────────────────
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

// ─── Import the component and the exported helper ────────────────────────────
import Navbar, { isActive } from '../Navbar';

// ─── Pure unit tests for isActive() ──────────────────────────────────────────
describe('isActive()', () => {
  it('matches exact root path', () => {
    expect(isActive('/', '/')).toBe(true);
  });

  it('does not match root for non-root href', () => {
    expect(isActive('/marketplace', '/')).toBe(false);
  });

  it('matches exact segment', () => {
    expect(isActive('/marketplace', '/marketplace')).toBe(true);
  });

  it('matches nested route under parent segment', () => {
    expect(isActive('/marketplace/abc123', '/marketplace')).toBe(true);
  });

  it('does not match a different top-level segment', () => {
    expect(isActive('/projects', '/marketplace')).toBe(false);
  });

  it('does not partially match a segment with a shared prefix', () => {
    // /marketplaceX should NOT match /marketplace
    expect(isActive('/marketplaceX', '/marketplace')).toBe(false);
  });

  it('matches deeply nested routes', () => {
    expect(isActive('/projects/123/details', '/projects')).toBe(true);
  });
});

// ─── Render tests: aria-current and active class ─────────────────────────────
describe('Navbar active link rendering', () => {
  it('sets aria-current="page" on the active link only', () => {
    mockUsePathname.mockReturnValue('/marketplace');
    render(<Navbar />);

    const activeLink = screen.getByRole('link', { name: 'Marketplace' });
    expect(activeLink).toHaveAttribute('aria-current', 'page');

    // All other nav links must NOT have aria-current
    const otherLinks = ['Projects', 'Audit', 'Retire', 'Dashboard'];
    otherLinks.forEach((label) => {
      expect(screen.getByRole('link', { name: label })).not.toHaveAttribute('aria-current');
    });
  });

  it('applies nav-link--active class to the active link', () => {
    mockUsePathname.mockReturnValue('/projects');
    render(<Navbar />);

    const activeLink = screen.getByRole('link', { name: 'Projects' });
    expect(activeLink).toHaveClass('nav-link--active');
    expect(activeLink).toHaveClass('nav-link');
  });

  it('does not apply nav-link--active to inactive links', () => {
    mockUsePathname.mockReturnValue('/projects');
    render(<Navbar />);

    expect(screen.getByRole('link', { name: 'Marketplace' })).not.toHaveClass('nav-link--active');
  });

  it('highlights parent link for a nested route', () => {
    mockUsePathname.mockReturnValue('/marketplace/abc123');
    render(<Navbar />);

    const marketplaceLink = screen.getByRole('link', { name: 'Marketplace' });
    expect(marketplaceLink).toHaveAttribute('aria-current', 'page');
    expect(marketplaceLink).toHaveClass('nav-link--active');
  });

  it('renders no active link when on an unrelated path', () => {
    mockUsePathname.mockReturnValue('/unknown-page');
    render(<Navbar />);

    const navLinks = screen.getAllByRole('link').filter((el) =>
      el.classList.contains('nav-link')
    );
    navLinks.forEach((link) => {
      expect(link).not.toHaveAttribute('aria-current');
      expect(link).not.toHaveClass('nav-link--active');
    });
  });
});
