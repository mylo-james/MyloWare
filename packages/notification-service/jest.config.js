const { pathsToModuleNameMapper } = require('ts-jest');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/main.ts',
    '!src/app.module.ts',
    '!src/controllers/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  passWithNoTests: true,
  // IMPORTANT: In tests we map to shared/src for rich type info and easier mocking.
  // Build uses tsconfig paths to shared/dist to avoid rootDir errors (TS6059).
  moduleNameMapper: {
    '^@myloware/shared$': '<rootDir>/../shared/src/index.ts',
    '^@myloware/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },
  transformIgnorePatterns: ['/node_modules/(?!(supertest)/)'],
};
