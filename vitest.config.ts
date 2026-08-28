import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // .mise/ holds a trusted-config symlink back into the repo root, so without
    // this every test file is collected and run twice.
    exclude: ['node_modules/**', 'dist/**', '.mise/**'],
  },
});
