module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@Web/(.*)$': '<rootDir>/src/Web/$1',
    '^@Application/(.*)$': '<rootDir>/src/Host/Application/$1',
    '^@Infrastructure/(.*)$': '<rootDir>/src/Host/Infrastructure/$1',
    '^@Domain/(.*)$': '<rootDir>/src/Host/Domain/$1',
    '^@Presentation/(.*)$': '<rootDir>/src/Host/Presentation/$1',
    '^@Shared/(.*)$': '<rootDir>/src/Shared/$1',
    '^@Queries/(.*)$': '<rootDir>/src/Shared/Features/Queries/$1',
    '^@Commands/(.*)$': '<rootDir>/src/Shared/Features/Commands/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/Web/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
    }],
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
};
