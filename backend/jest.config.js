module.exports = {
  displayName: 'backend',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  setupFiles: ['<rootDir>/jest.setup.ts'],   // ← ADD THIS LINE
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {
      diagnostics: false,
    }],
  },
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
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};