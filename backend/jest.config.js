module.exports = {
  displayName: 'backend',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {
      // Don't fail tests on TypeScript type errors (Prisma client not generated in CI)
      diagnostics: false,
    }],
  },
  // uuid v14+ ships as ESM; map it to the CJS build so Jest can import it
  moduleNameMapper: {
    '^uuid$': '<rootDir>/../node_modules/uuid/dist-node/index.js',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.spec.ts',
    '!**/node_modules/**',
  ],
  coverageDirectory: '../coverage',
  coverageReporters: ['text', 'lcov', 'json', 'html'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
