#!/usr/bin/env node
/**
 * Starts Prometheus against config/prometheus.yml and waits until it is ready
 * to answer queries.
 *
 * Prometheus is downloaded into vendor/ by `npm run setup` rather than
 * installed from a package manager, so the binary is always the pinned version
 * from config/versions.json on every attendee's machine.
 *
 *   node scripts/prometheus-up.mjs
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, open, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versions = JSON.parse(await readFile(path.join(ROOT, 'config/versions.json'), 'utf8'));

const { prometheusPort, exporterPort } = versions.grid;

const BIN = path.join(
  ROOT,
  'vendor/prometheus',
  process.platform === 'win32' ? 'prometheus.exe' : 'prometheus',
);
const CONFIG = path.join(ROOT, 'config/prometheus.yml');
const DATA_DIR = path.join(ROOT, 'prometheus-data');
const RUN_DIR = path.join(ROOT, '.run');
const LOG_DIR = path.join(ROOT, 'logs');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function serving(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(label, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let spin = 0;
  const frames = ['|', '/', '-', '\\'];
  while (Date.now() < deadline) {
    if (await predicate()) {
      process.stdout.write('\r\x1b[K');
      return true;
    }
    process.stdout.write(`\r  ${frames[spin++ % 4]} waiting for ${label}...`);
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write('\r\x1b[K');
  throw new Error(`timed out waiting for ${label}`);
}

// ---------------------------------------------------------------------------
console.log(`\n${c.bold('Starting Prometheus')} ${c.dim(versions.prometheus.version)}\n`);

if (!(await exists(BIN))) {
  console.error(c.red('  vendor/prometheus is missing.'), 'Run `npm run setup` first.');
  process.exit(1);
}

// A port that is already busy is usually our own Prometheus from earlier in the
// day, which is fine and worth saying rather than spawning a second one that
// exits immediately with "address already in use".
if (!(await portFree(prometheusPort))) {
  if (await serving(`http://127.0.0.1:${prometheusPort}/-/ready`)) {
    console.log(c.green('  Already running.'), c.dim(`http://localhost:${prometheusPort}`));
    process.exit(0);
  }
  console.error(c.red(`  Port ${prometheusPort} is in use by something that is not Prometheus.`));
  console.error(c.dim('  Grafana and other Prometheus instances default to 9090 too.'));
  console.error(
    c.dim(
      process.platform === 'win32'
        ? `  Find it with: netstat -ano | findstr :${prometheusPort}`
        : `  Find it with: lsof -nP -iTCP:${prometheusPort} -sTCP:LISTEN`,
    ),
  );
  process.exit(1);
}

await mkdir(RUN_DIR, { recursive: true });
await mkdir(LOG_DIR, { recursive: true });
await mkdir(DATA_DIR, { recursive: true });

const logPath = path.join(LOG_DIR, 'prometheus.log');

// Same detached-with-file-descriptor spawn as grid-up.mjs: piped stdio would
// keep this process alive for as long as Prometheus ran, so it could never
// exit and hand the terminal back.
const fd = await open(logPath, 'w');
const child = spawn(
  BIN,
  [
    `--config.file=${CONFIG}`,
    `--storage.tsdb.path=${DATA_DIR}`,
    // 127.0.0.1 rather than the default :9090, for the same reason the scrape
    // targets in config/prometheus.yml use it: binding IPv4-only keeps the
    // self-scrape target UP, and it avoids the macOS firewall prompt.
    `--web.listen-address=127.0.0.1:${prometheusPort}`,
  ],
  {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', fd.fd, fd.fd],
    detached: true,
  },
);
child.on('error', (err) => {
  console.error(c.red(`  Prometheus failed to spawn: ${err.message}`));
});
child.unref();
await writeFile(path.join(RUN_DIR, 'prometheus.pid'), String(child.pid));

try {
  await waitFor(
    'Prometheus',
    () => serving(`http://127.0.0.1:${prometheusPort}/-/ready`),
    30_000,
  );
} catch (err) {
  console.error(c.red(`\n  ${err.message}`));
  console.error(`  Check ${path.relative(ROOT, logPath)}. A bad config file is the usual cause.`);
  process.exit(1);
} finally {
  // Prometheus holds its own duplicated descriptor, so closing ours does not
  // truncate its log.
  await fd.close().catch(() => {});
}

console.log(`${c.green(c.bold('Prometheus ready.'))}\n`);
console.log(`  graphs      http://localhost:${prometheusPort}/graph`);
console.log(`  targets     http://localhost:${prometheusPort}/targets`);
console.log(`  logs        ${path.relative(ROOT, logPath)}`);

// The graphs are empty without the exporter, and an empty graph mid-workshop
// looks like Prometheus is broken. Say so now instead.
if (!(await serving(`http://127.0.0.1:${exporterPort}/metrics`))) {
  console.log(
    `\n  ${c.yellow('Note:')} nothing is serving metrics on :${exporterPort} yet, so the ` +
      `selenium-grid\n        target will be down. Start it with: npm run exporter`,
  );
}

console.log(`\n  ${c.dim('stop everything with: npm run stop')}\n`);
