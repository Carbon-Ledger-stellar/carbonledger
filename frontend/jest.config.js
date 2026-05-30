/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-jsdom',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react',
          rootDir: '.',
          moduleResolution: 'node',
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
  testPathIgnorePatterns: ['/node_modules/', '/tests/'],
  // Scope coverage to the 4 lib files required by issue #96
  collectCoverageFrom: [
    'lib/stellar.ts',
    'lib/soroban.ts',
    'lib/carbon-utils.ts',
    'lib/wallet-errors.ts',
  ],
  coverageThreshold: {
    global: { lines: 80, functions: 80, branches: 80, statements: 80 },
  },
};

module.exports = config;
