// Vitest config wiring the @cloudflare/vitest-pool-workers pool so tests
// run inside the Workers runtime against wrangler.jsonc.

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    passWithNoTests: true,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
