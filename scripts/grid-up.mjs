#!/usr/bin/env node
/**
 * Starts the Selenium Grid hub and N nodes, and waits until every node has
 * registered.
 *
 * The exact flags here were arrived at empirically. Two of them are not
 * optional, and the failure modes without them are extremely confusing - see
 * the comments on BUS_ARGS and `--host`.
 *
 *   node scripts/grid-up.mjs            3 nodes (default)
 *   node scripts/grid-up.mjs --nodes 2  low-memory mode
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versions = JSON.parse(await readFile(path.join(ROOT, 'config/versions.json'), 'utf8'));

const JAR = path.join(ROOT, 'vendor', versions.selenium.jar);
const { hubPort, eventPublishPort, eventSubscribePort, nodePorts, maxSessionsPerNode } =
  versions.grid;

const args = process.argv.slice(2);
const nodeCountArg = args.indexOf('--nodes');
const nodeCount = nodeCountArg !== -1 ? Number(args[nodeCountArg + 1]) : nodePorts.length;

if (!Number.isInteger(nodeCount) || nodeCount < 1 || nodeCount > nodePorts.length) {
  console.error(`--nodes must be between 1 and ${nodePorts.length}`);
  process.exit(1);
}

const nodesToStart = nodeCount;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/**
 * Pin the ZeroMQ event bus to the IPv4 loopback address.
 *
 * NOT OPTIONAL. Left to itself, the hub advertises the event bus on the first
 * non-loopback interface it finds - often an IPv6 link-local address like
 * fe80::...%en0. JeroMQ then calls setReuseAddress() on each accepted channel,
 * which throws "java.net.SocketException: Invalid argument" on macOS. The
 * result is a hub that answers HTTP perfectly, logs hundreds of ZMQ stack
 * traces, and silently never registers a single node, while every node happily
 * repeats "Sending registration event..." forever.
 *
 * Everything in this workshop is on one machine, so loopback is also simply
 * the correct address, and it avoids the OS firewall prompt entirely.
 */
const BUS_ARGS = [
  '--publish-events',
  `tcp://127.0.0.1:${eventPublishPort}`,
  '--subscribe-events',
  `tcp://127.0.0.1:${eventSubscribePort}`,
];

const RUN_DIR = path.join(ROOT, '.run');
const LOG_DIR = path.join(ROOT, 'logs');
await mkdir(RUN_DIR, { recursive: true });
await mkdir(LOG_DIR, { recursive: true });

/** Log file handles, closed just before we exit and leave the Grid running. */
const openLogFds = [];

async function launch(label, jarArgs) {
  const logPath = path.join(LOG_DIR, `${label}.log`);

  // Write straight to a file descriptor rather than piping through this
  // process. Piped stdio would keep our event loop alive forever, so the
  // script could never exit while the Grid was running - and `detached` plus
  // `unref` lets the hub and nodes outlive us, which is the whole point.
  const fd = await open(logPath, 'w');
  const child = spawn('java', ['-jar', JAR, ...jarArgs], {
    env: process.env,
    stdio: ['ignore', fd.fd, fd.fd],
    detached: true,
  });
  child.on('error', (err) => {
    console.error(c.red(`  ${label} failed to spawn: ${err.message}`));
  });
  child.unref();
  await writeFile(path.join(RUN_DIR, `${label}.pid`), String(child.pid));
  openLogFds.push(fd);
  return { child, logPath };
}

async function gridQuery(query) {
  const res = await fetch(`http://localhost:${hubPort}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

async function waitFor(label, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let spin = 0;
  const frames = ['|', '/', '-', '\\'];
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value !== false && value !== undefined) {
        process.stdout.write('\r\x1b[K');
        return value;
      }
    } catch {
      // Not ready yet.
    }
    process.stdout.write(`\r  ${frames[spin++ % 4]} waiting for ${label}...`);
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write('\r\x1b[K');
  throw new Error(`timed out waiting for ${label}`);
}

// ---------------------------------------------------------------------------
console.log(`\n${c.bold('Starting Selenium Grid')} ${c.dim(`(${nodesToStart} nodes, 1 slot each)`)}\n`);

// Hub
await launch('hub', ['hub', '--host', 'localhost', ...BUS_ARGS]);
console.log(`  hub      ${c.dim(`http://localhost:${hubPort}`)}`);

try {
  await waitFor(
    'the hub',
    async () => {
      const res = await fetch(`http://localhost:${hubPort}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    },
    60_000,
  );
} catch {
  console.error(c.red('\n  The hub did not come up. Check logs/hub.log.'));
  process.exit(1);
}

// Nodes
for (let i = 0; i < nodesToStart; i++) {
  const port = nodePorts[i];
  await launch(
    `node-${i + 1}`,
    [
      'node',
      '--port',
      String(port),
      // Advertise loopback. Otherwise the node reports its LAN IP, the hub
      // health-checks an address the firewall may block, and registration
      // fails with no useful error anywhere.
      '--host',
      'localhost',
      '--hub',
      `http://localhost:${hubPort}`,
      // Playwright resolves its CDP websocket through this address.
      '--grid-url',
      `http://localhost:${hubPort}`,
      ...BUS_ARGS,
      // Chrome only: Playwright's Grid integration cannot drive anything else,
      // and it keeps the console showing exactly one slot per node.
      '--driver-implementation',
      'chrome',
      // The whole point: 3 nodes x 1 = 3 slots on every attendee's hardware,
      // instead of one slot per CPU core.
      '--max-sessions',
      String(maxSessionsPerNode),
      // Selenium Manager downloads a chromedriver matching the local Chrome.
      '--selenium-manager',
      'true',
      // Reclaim a slot if a session goes idle, so one wedged test does not
      // poison the rest of the session.
      '--session-timeout',
      '120',
    ],
  );
  console.log(`  node ${i + 1}   ${c.dim(`http://localhost:${port}`)}`);
}

// Wait for registration
try {
  const registered = await waitFor(
    `${nodesToStart} node(s) to register`,
    async () => {
      const data = await gridQuery('{ grid { nodeCount, totalSlots } }');
      return data.grid.nodeCount >= nodesToStart ? data.grid : false;
    },
    120_000,
  );

  console.log(
    `\n${c.green(c.bold('Grid ready.'))} ` +
    `${registered.nodeCount} nodes, ${registered.totalSlots} slots.\n`,
  );
  console.log(`  console     http://localhost:${hubPort}/ui`);
  console.log(`  logs        logs/hub.log, logs/node-*.log`);
  console.log(`\n  ${c.dim('stop everything with: npm run stop')}\n`);
} catch (err) {
  console.error(c.red(`\n  ${err.message}`));
  console.error('  Check logs/node-1.log. The usual causes are in docs/SETUP.md#troubleshooting.');
  process.exit(1);
} finally {
  // The children hold their own duplicated descriptors, so closing ours does
  // not truncate their logs - it just lets this process exit.
  await Promise.all(openLogFds.map((fd) => fd.close().catch(() => { })));
}
