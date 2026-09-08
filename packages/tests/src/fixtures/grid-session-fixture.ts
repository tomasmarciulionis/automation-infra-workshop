import { createRequire } from 'node:module';

import { test as base } from '@playwright/test';

/**
 * Playwright registers its Selenium disconnect in two places - as the
 * browser's `onClose` and in `gracefullyCloseSet` - and only de-registers it
 * once the `DELETE /session/<id>` resolves. The browser-close path fires it
 * from a `Disconnected` listener, which nobody awaits, so `browser.close()`
 * returns with the request still in flight and the entry still in the set.
 * `gracefullyCloseAll()` then sends a second `DELETE`, the node proxies it to
 * a chromedriver that is already gone, and it hangs for the node's read
 * timeout - inside the worker teardown budget, which it duly blows.
 *
 * So wait for the set to drain. That is the exact condition, and it is the
 * request's real duration rather than a guess: measured against the workshop
 * Grid it costs ~400ms, where a fixed sleep long enough to be safe everywhere
 * would cost several times that on every worker.
 *
 * This fixture is set up before the browser exists, so it tears down after
 * the browser and before Playwright's process-level cleanup - the only window
 * where the wait does any good.
 */
const require = createRequire(import.meta.url);

/**
 * Not public API. Asserted rather than optional-chained, because the failure
 * mode of a silent miss is a suite that quietly goes back to hanging on every
 * worker, which is exactly what this fixture exists to prevent.
 */
const { gracefullyCloseSet } = require('playwright-core/lib/coreBundle').utils as {
  gracefullyCloseSet?: Set<unknown>;
};

if (!(gracefullyCloseSet instanceof Set)) {
  throw new Error(
    'playwright-core no longer exposes utils.gracefullyCloseSet from lib/coreBundle. ' +
      'Re-check the Selenium teardown race in grid-session-fixture.ts against the ' +
      'installed Playwright before removing this guard.',
  );
}

/** Generous: it only bounds a pathological case, it is not the expected wait. */
const DRAIN_TIMEOUT_MS = 10_000;

export const test = base.extend<object, { gridSession: void }>({
  gridSession: [
    async ({}, use) => {
      const onGrid = !!process.env.SELENIUM_REMOTE_URL;

      await use();

      if (!onGrid) return;

      const deadline = Date.now() + DRAIN_TIMEOUT_MS;
      while (gracefullyCloseSet.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    { scope: 'worker', auto: true },
  ],
});
