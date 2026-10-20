"use client";

import { useEffect } from 'react';
import { useTheme } from '../lib/theme-context';

const THEME_STORAGE_KEY = 'theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: 'light' | 'dark' | 'system') {
  if (typeof document === 'undefined') return;
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
}

export default function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  // Restore persisted preference (or system default) and keep DOM in sync.
  useEffect(() => {
    let stored: 'light' | 'dark' | 'system' | null = null;
    try {
      const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (raw === 'light' || raw === 'dark' || raw === 'system') {
        stored = raw;
      }
    } catch {
      // localStorage may be unavailable (private mode, etc.)
    }

    if (stored && stored !== theme) {
      setTheme(stored);
      return;
    }

    applyTheme(theme);
  }, [theme, setTheme]);

  // Persist the user's choice whenever it changes.
  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore persistence failures
    }
  }, [theme]);

  // Follow system changes while in system mode.
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  const toggleTheme = () => {
    if (theme === 'light') {
      setTheme('dark');
    } else if (theme === 'dark') {
      setTheme('system');
    } else {
      setTheme('light');
    }
  };

  const getIcon = () => {
    if (theme === 'light') return '🌙'; // Moon for switching to dark
    if (theme === 'dark') return '💻'; // Computer for switching to system
    return '☀️'; // Sun for switching to light
  };

  const getLabel = () => {
    if (theme === 'light') return 'Switch to dark mode';
    if (theme === 'dark') return 'Use system preference';
    return 'Switch to light mode';
  };

  return (
    <button
      aria-label={getLabel()}
      onClick={toggleTheme}
      title={getLabel()}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '1.25rem',
        padding: '0.5rem',
        borderRadius: '0.375rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background-color 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--color-neutral-100)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {getIcon()}
    </button>
  );
}