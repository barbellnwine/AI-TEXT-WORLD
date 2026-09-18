import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'npm run server', url: 'http://127.0.0.1:18787/api/ai-community/status',
      env: { PORT: '18787', AI_COMMUNITY_DB_PATH: ':memory:', AI_COMMUNITY_ADMIN_TOKEN: 'e2e-demo-token',
        AI_COMMUNITY_ENABLED: 'false', AI_COMMUNITY_DEMO_MODE: 'true', AI_COMMUNITY_COOLDOWN_MS: '0',
        AI_COMMUNITY_TICK_INTERVAL_MS: '3600000', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' },
    },
    { command: 'npm run dev -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173',
      env: { AI_COMMUNITY_PROXY_TARGET: 'http://127.0.0.1:18787' } },
  ],
  projects: [ { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } } ],
})
