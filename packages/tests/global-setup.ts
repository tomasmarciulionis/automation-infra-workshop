import type { FullConfig } from '@playwright/test';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const EXPORTER_URL = process.env.EXPORTER_URL ?? 'http://localhost:9615';

/**
 * Tell the Grid exporter a run is starting, so it can count browser launches
 * per run rather than as one unbroken total. The Grid cannot work this out for
 * itself - it sees a stream of sessions and no run boundaries - and this is
 * the one place that happens exactly once per run.
 *
 * Best effort on purpose: the exporter is an observability nicety, and a suite
 * that refuses to run because nothing is watching it would be a bad trade.
 */
async function announceRun(runId: string): Promise<void> {
  try {
    await fetch(`${EXPORTER_URL}/run/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: runId }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    console.log('[setup] no exporter listening, per-run browser counts unavailable');
  }
}

/**
 * Runs once before any worker starts.
 *
 * Resets the application, and tells it how many workers this run will use.
 * The determinism harness behind planted failure 1 needs the worker count to
 * distinguish a serial run from a parallel one - see app/sequencer.mjs.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${APP_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${path} responded ${response.status}`);
    }
    return response.json();
  };

  try {
    await post('/api/_test/reset', {});
    await post('/api/_test/config', { workers: config.workers });
  } catch (error) {
    throw new Error(
      `Could not reach the demo app at ${APP_URL}. Start it with \`npm run app\` ` +
        `(or the whole stack with \`npm run up\`).\n  ${(error as Error).message}`,
    );
  }

  const runId = process.env.RUN_ID ?? new Date().toISOString();
  await announceRun(runId);

  console.log(`[setup] app reset, running with ${config.workers} worker(s), run ${runId}`);
}
