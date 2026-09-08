#!/usr/bin/env node
/**
 * Selenium Grid -> Prometheus exporter.
 *
 * Selenium Grid 4 has no native /metrics endpoint. Its only machine-readable
 * observability surfaces are OpenTelemetry traces and a GraphQL API, so the
 * standard approach - and what the official Helm chart does - is to poll
 * GraphQL and re-publish it in Prometheus text format. That is all this does.
 *
 * Zero dependencies on purpose: attendees already have Node, and this file is
 * short enough to read during the workshop.
 *
 *   node tools/grid-exporter.mjs
 *   curl http://localhost:9615/metrics
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versions = JSON.parse(await readFile(path.join(ROOT, 'config/versions.json'), 'utf8'));

const HUB_URL = process.env.GRID_URL ?? `http://localhost:${versions.grid.hubPort}`;
const PORT = Number(process.env.EXPORTER_PORT ?? versions.grid.exporterPort);

const QUERY = `{
  grid { nodeCount, totalSlots, sessionCount, maxSession, sessionQueueSize, version }
  nodesInfo { nodes { id, uri, status, slotCount, sessionCount, stereotypes } }
  sessionsInfo { sessions { id, capabilities } }
}`;

async function fetchGrid() {
  const res = await fetch(`${HUB_URL}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) {
    throw new Error(`hub returned HTTP ${res.status}`);
  }
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  return body.data;
}

/** Escape a Prometheus label value. */
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** JSON that arrives from Grid as a string, parsed without taking the scrape down. */
function parseJson(text, fallback) {
  try {
    return JSON.parse(text) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Grid returns a session's capabilities as a JSON *string*, so it has to be
 * parsed to find out which browser the session is. An unparseable or
 * capability-less session is still a session: call it `unknown` rather than
 * dropping it, so the totals here always agree with sessionCount.
 */
function browserOf(session) {
  return parseJson(session.capabilities, {}).browserName || 'unknown';
}

/**
 * Every browser the Grid can run, from the nodes' advertised stereotypes.
 *
 * Used to publish an explicit 0 for an idle browser. Without it the series
 * would only exist while a session is alive and vanish in between, which reads
 * as "no data" on a graph rather than as "nothing is running" - unlike
 * selenium_grid_session_count, which is always present because it is a single
 * unlabelled sample. Note the stereotypes carry no browserVersion, which is
 * why this gauge is labelled by name alone: a zero-line labelled with some
 * placeholder version would be a different series from the live one, and so
 * would fill in nothing.
 */
function advertisedBrowsers(nodes) {
  const names = new Set();
  for (const node of nodes) {
    for (const entry of parseJson(node.stereotypes, [])) {
      names.add(entry?.stereotype?.browserName || 'unknown');
    }
  }
  return names;
}

/** Turn a `browser name -> number` map into samples, zero-filling advertised browsers. */
function browserSamples(counts, nodes) {
  const all = new Map([...advertisedBrowsers(nodes)].map((name) => [name, 0]));
  for (const [name, value] of counts) all.set(name, value);
  return [...all].map(([name, value]) => ({ labels: { browser_name: name }, value }));
}

/** Sessions per browser, right now. */
function byBrowser(sessions) {
  const counts = new Map();
  for (const session of sessions) {
    const name = browserOf(session);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/**
 * Cumulative session starts, by browser, since this process began.
 *
 * The gauge above answers "how many browsers are open"; this answers "how many
 * were launched", which is the number that exposes a spec opening a browser of
 * its own on top of the one its fixtures gave it - two starts per test where
 * the worker only accounts for one.
 *
 * Counted by diffing session ids between polls, and polls only happen when
 * Prometheus scrapes: a session that begins and ends entirely between two
 * scrapes is never seen. At the workshop's 2s interval and Playwright's
 * multi-second sessions that does not happen, but it is the reason this is not
 * exact bookkeeping.
 */
const sessionStarts = new Map();
const countedSessionIds = new Set();

/**
 * The same tally, but for one test run.
 *
 * The Grid has no idea a test run exists - it sees an unbroken stream of
 * sessions - so the runner has to say when one starts. global-setup.ts posts
 * to /run/start, which is already the one thing that happens exactly once per
 * run. Until it does, starts are attributed to run_id="none".
 */
let currentRun = { id: 'none', starts: new Map() };

function startRun(id) {
  currentRun = { id, starts: new Map() };
  console.log(`[exporter] run ${id} started`);
}

function recordSessionStarts(sessions) {
  const live = new Set();
  for (const session of sessions) {
    live.add(session.id);
    if (countedSessionIds.has(session.id)) continue;
    countedSessionIds.add(session.id);
    const name = browserOf(session);
    sessionStarts.set(name, (sessionStarts.get(name) ?? 0) + 1);
    currentRun.starts.set(name, (currentRun.starts.get(name) ?? 0) + 1);
  }
  // Drop finished sessions so the set cannot grow without bound over a long
  // run. Grid ids are unique, so a dropped id can never return and be counted
  // a second time.
  for (const id of countedSessionIds) {
    if (!live.has(id)) countedSessionIds.delete(id);
  }
}

function render(data) {
  const lines = [];
  const metric = (name, help, type, samples) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    for (const { labels, value } of samples) {
      const l = labels
        ? `{${Object.entries(labels)
            .map(([k, v]) => `${k}="${esc(v)}"`)
            .join(',')}}`
        : '';
      lines.push(`${name}${l} ${value}`);
    }
  };

  if (!data) {
    metric('selenium_grid_up', 'Whether the Grid hub is reachable.', 'gauge', [{ value: 0 }]);
    return `${lines.join('\n')}\n`;
  }

  const g = data.grid;
  metric('selenium_grid_up', 'Whether the Grid hub is reachable.', 'gauge', [{ value: 1 }]);

  metric('selenium_grid_node_count', 'Nodes currently registered with the Grid.', 'gauge', [
    { value: g.nodeCount },
  ]);

  metric('selenium_grid_total_slots', 'Total session slots across all nodes.', 'gauge', [
    { value: g.totalSlots },
  ]);

  metric('selenium_grid_max_session', 'Maximum concurrent sessions the Grid can run.', 'gauge', [
    { value: g.maxSession },
  ]);

  metric('selenium_grid_session_count', 'Sessions currently running.', 'gauge', [
    { value: g.sessionCount },
  ]);

  // The headline metric for this workshop: requests waiting for a free slot.
  metric(
    'selenium_grid_session_queue_size',
    'New-session requests waiting in the queue for a free slot.',
    'gauge',
    [{ value: g.sessionQueueSize }],
  );

  const nodes = data.nodesInfo?.nodes ?? [];

  // Same sessions as selenium_grid_session_count, split by browser. Playwright
  // over Grid is Chromium-only today, so in this workshop it is one series -
  // but it is the series that shows a spec launching a browser of its own on
  // top of the one its fixtures gave it.
  metric(
    'selenium_grid_browser_session_count',
    'Sessions currently running, by browser.',
    'gauge',
    browserSamples(byBrowser(data.sessionsInfo?.sessions ?? []), nodes),
  );

  metric(
    'selenium_grid_sessions_started_total',
    'Browser sessions started since the exporter began, by browser.',
    'counter',
    browserSamples(sessionStarts, nodes),
  );

  // A gauge rather than a counter: it restarts at 0 with every run, which is
  // the whole point of it, and rate()/increase() over a resetting series would
  // say something misleading. Read it directly - it is the answer to "how many
  // browsers did this run launch".
  metric(
    'selenium_grid_run_sessions_started',
    'Browser sessions started during the current test run, by browser.',
    'gauge',
    browserSamples(currentRun.starts, nodes).map(({ labels, value }) => ({
      labels: { ...labels, run_id: currentRun.id },
      value,
    })),
  );

  const labelsFor = (n) => ({ node_id: n.id, uri: n.uri, status: n.status });

  metric(
    'selenium_grid_node_session_count',
    'Sessions currently running on a specific node.',
    'gauge',
    nodes.map((n) => ({ labels: labelsFor(n), value: n.sessionCount })),
  );

  metric(
    'selenium_grid_node_slot_count',
    'Total slots on a specific node.',
    'gauge',
    nodes.map((n) => ({ labels: labelsFor(n), value: n.slotCount })),
  );

  metric(
    'selenium_grid_node_up',
    'Whether a specific node reports status UP.',
    'gauge',
    nodes.map((n) => ({ labels: labelsFor(n), value: n.status === 'UP' ? 1 : 0 })),
  );

  return `${lines.join('\n')}\n`;
}

let lastError = null;

const server = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok\n');
    return;
  }

  // Called by the test runner's global setup. Body: {"id": "<run id>"}.
  if (req.url === '/run/start' && req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = parseJson(Buffer.concat(chunks).toString('utf8') || '{}', {});
    startRun(body.id || new Date().toISOString());
    res.writeHead(202, { 'Content-Type': 'text/plain' }).end(`${currentRun.id}\n`);
    return;
  }

  if (req.url !== '/metrics') {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('try /metrics\n');
    return;
  }

  let data = null;
  try {
    data = await fetchGrid();
    recordSessionStarts(data.sessionsInfo?.sessions ?? []);
    lastError = null;
  } catch (err) {
    // Report selenium_grid_up 0 rather than failing the scrape, so the gap is
    // visible in Prometheus as a value instead of a hole in the series. That
    // matters for the kill-a-node demo.
    if (err.message !== lastError) {
      lastError = err.message;
      console.warn(`[exporter] Grid unreachable: ${err.message}`);
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(render(data));
});

server.listen(PORT, () => {
  console.log(`[exporter] scraping ${HUB_URL}/graphql`);
  console.log(`[exporter] serving  http://localhost:${PORT}/metrics`);
});
