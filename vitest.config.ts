import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const truthy = (value?: string) =>
  value ? ['1', 'true', 'yes'].includes(value.toLowerCase()) : false;

const coverageEnabled =
  truthy(process.env.CI) ||
  truthy(process.env.TEST_DB_USE_CONTAINER) ||
  truthy(process.env.VITEST_COVERAGE);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/performance/**'],
    setupFiles: [
      './tests/setup/env.ts',
      './tests/setup/openai.ts',
      './tests/setup/database.ts',
    ],
    threads: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      enabled: coverageEnabled,
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      lines: 50,      // Interim floor; will raise to 80% in Epic 7
      functions: 50,  // Interim floor; will raise to 80% in Epic 7
      branches: 50,   // Interim floor; will raise to 75% in Epic 7
      statements: 50, // Interim floor; will raise to 80% in Epic 7
      exclude: ['**/*.test.ts', '**/test/**', '**/dist/**', '**/node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
