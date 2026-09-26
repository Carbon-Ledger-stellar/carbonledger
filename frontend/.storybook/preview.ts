import type { Preview } from '@storybook/react';
import React from 'react';
import { colors, darkColors, typography, spacing, borderRadius, shadows } from '../styles/design-system';

const designTokenGroups = {
  'Colors - Primary': {
    'primary-50': colors.primary[50],
    'primary-100': colors.primary[100],
    'primary-200': colors.primary[200],
    'primary-300': colors.primary[300],
    'primary-400': colors.primary[400],
    'primary-500': colors.primary[500],
    'primary-600': colors.primary[600],
    'primary-700': colors.primary[700],
    'primary-800': colors.primary[800],
    'primary-900': colors.primary[900],
  },
  'Colors - Neutral': {
    'neutral-50': colors.neutral[50],
    'neutral-100': colors.neutral[100],
    'neutral-200': colors.neutral[200],
    'neutral-300': colors.neutral[300],
    'neutral-400': colors.neutral[400],
    'neutral-500': colors.neutral[500],
    'neutral-600': colors.neutral[600],
    'neutral-700': colors.neutral[700],
    'neutral-800': colors.neutral[800],
    'neutral-900': colors.neutral[900],
  },
  'Typography': {
    'font-sans': typography.fontFamily.sans,
    'font-mono': typography.fontFamily.mono,
    'text-xs': typography.fontSize.xs,
    'text-sm': typography.fontSize.sm,
    'text-base': typography.fontSize.base,
    'text-lg': typography.fontSize.lg,
    'text-xl': typography.fontSize.xl,
    'text-2xl': typography.fontSize['2xl'],
    'text-3xl': typography.fontSize['3xl'],
    'text-4xl': typography.fontSize['4xl'],
    'text-5xl': typography.fontSize['5xl'],
  },
  'Spacing': Object.fromEntries(
    Object.entries(spacing).map(([k, v]) => [`space-${k}`, v])
  ),
  'Border Radius': {
    'radius-sm': borderRadius.sm,
    'radius-md': borderRadius.md,
    'radius-lg': borderRadius.lg,
    'radius-xl': borderRadius.xl,
    'radius-2xl': borderRadius['2xl'],
    'radius-full': borderRadius.full,
  },
  'Shadows': {
    'shadow-sm': shadows.sm,
    'shadow-md': shadows.md,
    'shadow-lg': shadows.lg,
    'shadow-xl': shadows.xl,
  },
};

// Theme decorator for dark mode toggle in Storybook
function ThemeDecorator(Story: any, context: any) {
  const theme = context.globals.theme || 'light';
  const resolvedTheme = theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  return React.createElement(Story);
}

const preview: Preview = {
  decorators: [ThemeDecorator],
  globalTypes: {
    theme: {
      description: 'Global theme for components',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
          { value: 'system', icon: 'computer', title: 'System' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
      expanded: true,
    },
    a11y: {
      config: {},
      options: {
        checks: { 'color-contrast': { options: { noScroll: true } } },
        runOn: true,
      },
    },
    docs: {
      autodocs: 'tag',
      page: () => null,
    },
    options: {
      storySort: {
        order: ['Foundation', 'Components', 'Layout', 'Patterns'],
      },
    },
  },
};

export default preview;
export { designTokenGroups };
