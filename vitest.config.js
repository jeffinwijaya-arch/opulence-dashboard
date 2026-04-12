import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Some tests need a DOM (module-loader, ws1 helpers that touch
    // document); keeping jsdom as the default keeps test files
    // lightweight.
    environment: 'jsdom',
    include: ['tests/js/**/*.test.js'],
    globals: false,
    // Fail fast on unhandled errors thrown inside async module code
    dangerouslyIgnoreUnhandledErrors: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/**/*.js',
        'public/modules/**/*.js',
        'public/enhanced-pricing.js',
      ],
      exclude: ['**/node_modules/**'],
    },
  },
});
