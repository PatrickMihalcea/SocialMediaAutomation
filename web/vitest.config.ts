import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Fixed, fake values for the variables the app refuses to start without.
    // The suite used to pass only when the shell running it happened to have
    // the real ones exported, and failed wholesale in one that did not. Tests
    // mock the database and never connect, so nothing here is ever used for
    // real — and nothing real is ever read into a test run.
    env: {
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/bridge88_test',
      AUTH_SECRET: 'test-auth-secret-not-used-anywhere-real',
      TOKEN_ENCRYPTION_KEY: 'test-token-encryption-key',
    },
    coverage: { reporter: ['text', 'html'] },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'src/test/server-only.ts'),
    },
  },
});
