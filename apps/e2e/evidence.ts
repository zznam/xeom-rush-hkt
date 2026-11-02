import type { PlaywrightTestConfig } from '@playwright/test';

/** Keep each suite's diagnostics separate; later suites must not erase earlier evidence. */
export function evidence(suite: string): PlaywrightTestConfig {
  return {
    outputDir: `./test-results/${suite}`,
    reporter: [['list'], ['json', { outputFile: `test-results/reports/${suite}.json` }]],
    use: {
      // Canvas animation makes continuous trace screencasts expensive. Keep DOM,
      // action and network evidence plus the explicit failure screenshot instead.
      trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true },
      screenshot: 'only-on-failure',
    },
  };
}
