module.exports = {
  displayName: 'backend',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // uuid and @smithy/* ship as ESM — allow ts-jest/babel to transform them
  transformIgnorePatterns: [
    'node_modules/(?!(uuid|@smithy|@aws-sdk)/)',
  ],
  // Map winston-cloudwatch to an automatic mock so tests don't need real AWS creds
  moduleNameMapper: {
    '^winston-cloudwatch$': '<rootDir>/../__mocks__/winston-cloudwatch.js',
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