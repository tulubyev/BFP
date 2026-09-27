module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/backend', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  transform: {
    // tests import frontend modules, which need DOM types (fetch Response etc.)
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { lib: ['ES2020', 'DOM', 'DOM.Iterable'] } }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'backend/**/*.ts',
    '!backend/**/*.d.ts',
    '!backend/server.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    // geotiff's CommonJS build require()s the ESM-only quick-lru: fine in Node ≥ 20.19, not in jest
    '^quick-lru$': '<rootDir>/tests/mocks/quick-lru.js',
    '^@/(.*)$': '<rootDir>/backend/$1',
    '^@services/(.*)$': '<rootDir>/backend/services/$1',
    '^@routes/(.*)$': '<rootDir>/backend/routes/$1',
    '^@models/(.*)$': '<rootDir>/backend/models/$1',
    '^@config/(.*)$': '<rootDir>/backend/config/$1',
    '^@utils/(.*)$': '<rootDir>/backend/utils/$1'
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  verbose: true
};
