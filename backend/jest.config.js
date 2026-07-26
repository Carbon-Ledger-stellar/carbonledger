module.exports = {
  displayName: 'backend',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // Sets DATABASE_URL/JWT_SECRET/etc before any module loads.
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {
      // Don't fail tests on TypeScript type errors (Prisma client not generated in CI)
      diagnostics: false,
    }],
  },
  // uuid v14+ is ESM-only (no CJS build), which Jest's CJS runtime can't load.
  // Map it to a small shim over node:crypto's randomUUID.
  moduleNameMapper: {
    '^uuid$': '<rootDir>/../test/uuid-cjs-shim.js',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.spec.ts',
    '!**/node_modules/**',
  ],
  coverageDirectory: '../coverage',
  coverageReporters: ['text', 'lcov', 'json', 'html'],
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
