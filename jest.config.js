module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  clearMocks: true,
  restoreMocks: true,
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  transform: {
    '^.+\\.[jt]s$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'es2022',
          module: 'commonjs',
          moduleResolution: 'node10',
          allowJs: true,
          isolatedModules: true,
          esModuleInterop: true,
          resolveJsonModule: true
        }
      }
    ]
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@noble|@algorandfoundation|abitype|@x402/express)/)'
  ]
};
