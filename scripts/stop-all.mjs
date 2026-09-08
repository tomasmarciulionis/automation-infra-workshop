#!/usr/bin/env node
/**
 * Stops everything the workshop starts and reaps orphans.
 *
 * This exists because the honest downside of running Grid nodes as bare
 * processes instead of containers is that a crashed node can leave orphaned
 * chromedriver and Chrome processes holding ports. Without this, the second
 * workshop run of the day fails in confusing ways.
 *
 * Safety: we only ever kill processes whose command line matches this repo's
 * own artifacts, plus Chrome instances carrying the automation flags that
 * chromedriver adds. A human's normal Chrome window is never touched.
 *
 * Usage:
 *   npm run stop                 stop everything
 *   npm run stop -- --grid-only  leave the app and Prometheus running
 *   npm run stop -- --dry-run    show what would be killed
 */

import { readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isOurs } from './lib/process-match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = path.join(ROOT, '.run');
const versions = JSON.parse(await readFile(path.join(ROOT, 'config/versions.json'), 'utf8'));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const gridOnly = args.includes('--grid-only');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function listProcesses() {
  if (process.platform === 'win32') {
    const script =
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }';
    const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    if (r.status !== 0) return [];
    return r.stdout
      .split(/\r?\n/)
      .map((line) => {
        const [pid, ...rest] = line.split('\t');
        return { pid: Number(pid), cmd: rest.join('\t') };
      })
      .filter((p) => Number.isInteger(p.pid) && p.cmd);
  }

  const r = spawnSync('ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout
    .split('\n')
    .map((line) => {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), cmd: m[2] } : null;
    })
    .filter(Boolean);
}

function kill(pid, signal = 'SIGTERM') {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), signal === 'SIGKILL' ? '/F' : '', '/T'].filter(Boolean));
    } else {
      process.kill(pid, signal);
    }
    return true;
  } catch {
    return false;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
console.log(`\n${c.bold('Stopping workshop processes')}${dryRun ? c.yellow('  (dry run)') : ''}\n`);

// 1. Recorded PIDs first - these are the processes we started on purpose.
let recorded = [];
try {
  const files = await readdir(RUN_DIR);
  for (const file of files.filter((f) => f.endsWith('.pid'))) {
    const pid = Number((await readFile(path.join(RUN_DIR, file), 'utf8')).trim());
    if (Number.isInteger(pid)) {
      recorded.push({ pid, label: file.replace(/\.pid$/, '') });
    }
  }
} catch {
  // .run/ does not exist yet - nothing was started via the scripts.
}

if (gridOnly) {
  recorded = recorded.filter((r) => /^(hub|node)/.test(r.label));
}

for (const { pid, label } of recorded) {
  if (!alive(pid)) {
    console.log(`${c.dim('  gone')}   ${label} ${c.dim(`pid ${pid}`)}`);
    continue;
  }
  if (dryRun) {
    console.log(`${c.yellow('  would')}  ${label} ${c.dim(`pid ${pid}`)}`);
  } else {
    kill(pid, 'SIGTERM');
    console.log(`${c.green('  sent')}   SIGTERM to ${label} ${c.dim(`pid ${pid}`)}`);
  }
}

// 2. Give the Grid a moment to shut down cleanly before hunting orphans.
if (!dryRun && recorded.length > 0) {
  await sleep(1500);
}

// 3. Sweep for anything matching our signatures, recorded or not.
const orphans = listProcesses().filter(
  (p) => p.pid !== process.pid && p.pid !== process.ppid && isOurs(p.cmd, { gridOnly }),
);

if (orphans.length === 0) {
  console.log(c.dim('\n  no orphaned processes found'));
} else {
  console.log(`\n${c.bold('Orphans')}`);
  for (const { pid, cmd } of orphans) {
    const short = cmd.length > 90 ? `${cmd.slice(0, 90)}...` : cmd;
    if (dryRun) {
      console.log(`${c.yellow('  would')}  ${pid} ${c.dim(short)}`);
      continue;
    }
    kill(pid, 'SIGTERM');
    console.log(`${c.green('  killed')} ${pid} ${c.dim(short)}`);
  }

  // 4. Anything still standing gets SIGKILL.
  if (!dryRun) {
    await sleep(1500);
    const stubborn = orphans.filter((p) => alive(p.pid));
    for (const { pid } of stubborn) {
      kill(pid, 'SIGKILL');
      console.log(`${c.red('  SIGKILL')} ${pid}`);
    }
  }
}

// 5. Clean up PID files so `doctor` does not report ghosts.
if (!dryRun) {
  await rm(RUN_DIR, { recursive: true, force: true });
}

// 6. Confirm the ports actually came back.
if (!dryRun) {
  const g = versions.grid;
  const watched = gridOnly
    ? [g.hubPort, g.eventPublishPort, g.eventSubscribePort, ...g.nodePorts]
    : [
        g.hubPort,
        g.eventPublishPort,
        g.eventSubscribePort,
        ...g.nodePorts,
        g.exporterPort,
        g.prometheusPort,
        g.appPort,
      ];

  const stillBusy = [];
  for (const port of watched) {
    if (!(await portFree(port))) {
      stillBusy.push(port);
    }
  }

  console.log();
  if (stillBusy.length === 0) {
    console.log(c.green(c.bold('All ports released.')));
  } else {
    console.log(c.yellow(c.bold(`Ports still in use: ${stillBusy.join(', ')}`)));
    console.log(c.dim('  Something outside this repo is holding them.'));
    console.log(
      c.dim(
        process.platform === 'win32'
          ? '  Find it with: netstat -ano | findstr :4444'
          : '  Find it with: lsof -nP -iTCP:4444 -sTCP:LISTEN',
      ),
    );
  }
}
