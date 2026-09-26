'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useWallet } from '@/lib/wallet/WalletContext';
import { useTheme } from '@/lib/theme-context';
import { useEffect, useState } from 'react';
import { useAppLocale } from '@/components/LocaleProvider';
import { locales, type AppLocale } from '@/i18n/routing';

const NAV_LINKS = [
  { href: '/marketplace', labelKey: 'marketplace' },
  { href: '/projects',    labelKey: 'projects' },
  { href: '/audit',       labelKey: 'audit' },
  { href: '/retire',      labelKey: 'retire' },
  { href: '/dashboard',   labelKey: 'dashboard' },
] as const;

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export default function Navbar() {
  const pathname = usePathname();
  const t = useTranslations('navbar');
  const { locale, setLocale } = useAppLocale();
  const { isConnected, publicKey, error, connect, disconnect, checkNetwork } = useWallet();
  const { theme, setTheme } = useTheme();
  const [networkWarning, setNetworkWarning] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (isConnected) {
      checkNetwork().then(({ isCorrect, currentNetwork }) => {
        setNetworkWarning(isCorrect ? null : t('networkMismatch', { network: currentNetwork }));
      });
    }
  }, [isConnected, checkNetwork, t]);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Close on Escape
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const handleConnect = async () => {
    const result = await connect();
    if (!result.success && result.error?.includes('not installed')) {
      if (confirm(t('freighterNotInstalled'))) {
        window.open('https://freighter.app/', '_blank');
      }
    }
  };

  const truncateAddress = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

  const localeLabels: Record<AppLocale, string> = {
    en: t('localeEn'),
    es: t('localeEs'),
    pt: t('localePt'),
    zh: t('localeZh'),
  };

  const languageSwitcher = (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.875rem' }}>
      <span className="sr-only">{t('language')}</span>
      <select
        aria-label={t('language')}
        value={locale}
        onChange={(e) => setLocale(e.target.value as AppLocale)}
        style={{
          background: '#16213e',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '4px',
          padding: '0.35rem 0.5rem',
          cursor: 'pointer',
        }}
      >
        {locales.map((loc) => (
          <option key={loc} value={loc}>
            {localeLabels[loc]}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <nav style={styles.nav} aria-label={t('mainNav')}>
        {/* Logo */}
        <Link href="/" style={styles.logoLink}>{t('brand')}</Link>

        {/* Desktop nav links */}
        <ul style={styles.navList} role="list" className="desktop-nav">
          {NAV_LINKS.map(({ href, labelKey }) => {
            const active = isActive(pathname, href);
            const label = t(labelKey);
            return (
              <li key={href}>
                <Link href={href} className={active ? 'nav-link nav-link--active' : 'nav-link'} aria-current={active ? 'page' : undefined}>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Wallet + theme — desktop */}
        <div style={styles.right} className="desktop-nav">
          {languageSwitcher}
          {error && <span style={styles.error}>{error}</span>}
          {networkWarning && <span style={styles.warning}>{networkWarning}</span>}
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} style={styles.connectBtn}>
            {theme === 'dark' ? t('light') : t('dark')}
          </button>
          {isConnected && publicKey ? (
            <div style={styles.walletInfo}>
              <span style={styles.address}>{truncateAddress(publicKey)}</span>
              <button onClick={disconnect} style={styles.disconnectBtn}>{t('disconnect')}</button>
            </div>
          ) : (
            <button onClick={handleConnect} style={styles.connectBtn}>{t('connectWallet')}</button>
          )}
        </div>

        {/* Hamburger — mobile only */}
        <button
          className="hamburger-btn"
          aria-label={drawerOpen ? t('closeMenu') : t('openMenu')}
          aria-expanded={drawerOpen}
          aria-controls="mobile-drawer"
          onClick={() => setDrawerOpen(v => !v)}
          style={styles.hamburger}
        >
          <span style={styles.hamburgerBar} />
          <span style={styles.hamburgerBar} />
          <span style={styles.hamburgerBar} />
        </button>
      </nav>

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          aria-hidden="true"
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 199,
            background: 'rgba(0,0,0,0.5)',
          }}
        />
      )}

      {/* Mobile drawer */}
      <div
        id="mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t('navMenu')}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: '280px', zIndex: 200,
          background: '#1a1a2e', color: '#fff',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
          display: 'flex', flexDirection: 'column',
          padding: '1.5rem 1rem',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <Link href="/" style={{ ...styles.logoLink, fontSize: '1.1rem' }} onClick={() => setDrawerOpen(false)}>
            {t('brand')}
          </Link>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label={t('closeMenu')}
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer', padding: '0.25rem' }}
          >
            ✕
          </button>
        </div>

        <nav aria-label={t('mobileNav')}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {NAV_LINKS.map(({ href, labelKey }) => {
              const active = isActive(pathname, href);
              const label = t(labelKey);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setDrawerOpen(false)}
                    style={{
                      display: 'block',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.5rem',
                      textDecoration: 'none',
                      fontWeight: active ? 700 : 500,
                      fontSize: '1rem',
                      background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
                      color: active ? '#fff' : 'rgba(255,255,255,0.75)',
                      borderLeft: active ? '3px solid #4CAF50' : '3px solid transparent',
                    }}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {languageSwitcher}
          {networkWarning && <span style={{ ...styles.warning, fontSize: '0.8rem' }}>{networkWarning}</span>}
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} style={{ ...styles.connectBtn, width: '100%' }}>
            {theme === 'dark' ? t('lightMode') : t('darkMode')}
          </button>
          {isConnected && publicKey ? (
            <>
              <span style={{ ...styles.address, textAlign: 'center' }}>{truncateAddress(publicKey)}</span>
              <button onClick={disconnect} style={{ ...styles.disconnectBtn, width: '100%' }}>{t('disconnect')}</button>
            </>
          ) : (
            <button onClick={handleConnect} style={{ ...styles.connectBtn, width: '100%' }}>{t('connectWallet')}</button>
          )}
        </div>
      </div>

      <style>{`
        .hamburger-btn { display: none !important; }
        @media (max-width: 767px) {
          .desktop-nav { display: none !important; }
          .hamburger-btn { display: flex !important; flex-direction: column; margin-left: auto; }
        }
      `}</style>
    </>
  );
}

const styles = {
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '0 2rem',
    backgroundColor: '#1a1a2e',
    color: '#fff',
    flexWrap: 'wrap' as const,
    minHeight: '64px',
    position: 'relative' as const,
    zIndex: 100,
  },
  logoLink: {
    fontSize: '1.25rem',
    fontWeight: 'bold' as const,
    color: '#fff',
    textDecoration: 'none',
    marginRight: '1rem',
  },
  navList: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    listStyle: 'none',
    margin: 0,
    padding: 0,
    flex: 1,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flexWrap: 'wrap' as const,
    marginLeft: 'auto',
  },
  hamburger: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0.5rem',
    gap: '5px',
  },
  hamburgerBar: {
    display: 'block',
    width: '24px',
    height: '2px',
    background: '#fff',
    borderRadius: '2px',
  },
  connectBtn: {
    padding: '0.5rem 1rem',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  disconnectBtn: {
    padding: '0.5rem 1rem',
    backgroundColor: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  walletInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  address: {
    padding: '0.5rem 1rem',
    backgroundColor: '#16213e',
    borderRadius: '4px',
    fontFamily: 'monospace',
    color: '#fff',
  },
  error: {
    color: '#ff6b6b',
    fontSize: '0.875rem',
  },
  warning: {
    color: '#ffc107',
    fontSize: '0.875rem',
  },
};
