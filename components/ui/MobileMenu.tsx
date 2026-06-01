import { useState } from 'react';
import Link from 'next/link';
import { useIsMobile } from '@/hooks/useMediaQuery';

interface MenuItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
}

interface MobileMenuProps {
  items: MenuItem[];
}

export function MobileMenu({ items }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useIsMobile();

  if (!isMobile) return null;

  return (
    <>
      {/* Hamburger button */}
      <button
        className="mobile-menu-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Menu"
        style={{
          minHeight: '44px',
          minWidth: '44px',
          background: 'none',
          border: 'none',
          cursor: 'pointer'
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Mobile overlay menu */}
      {isOpen && (
        <>
          <div
            className="mobile-menu-overlay"
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              zIndex: 999
            }}
          />
          <div
            className="mobile-menu-drawer"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: '80%',
              maxWidth: '300px',
              backgroundColor: 'white',
              zIndex: 1000,
              padding: '20px',
              boxShadow: '-2px 0 8px rgba(0,0,0,0.1)'
            }}
          >
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px',
                  minHeight: '44px',
                  textDecoration: 'none',
                  color: '#374151'
                }}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
