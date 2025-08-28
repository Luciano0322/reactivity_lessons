import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [react(), vue()],
  test: {
    setupFiles: ['tests/setup.ts'],
    environment: 'jsdom',
    deps: { inline: ['vue'] },
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [
        { browser: 'chromium' },
      ],
    },
  },
});
