#!/usr/bin/env node
/**
 * Pre-flight environment check. Run this before the workshop and again at the
 * start of it. Every failure line tells you exactly how to fix it, so attendees
 * can self-serve instead of queueing for the instructor.
 */

import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versions = JSON.parse(await readFile(path.join(ROOT, 'config/versions.json'), 'utf8'));

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const results = [];
const pass = (name, detail) => results.push({ level: 'pass', name, detail });
const warn = (name, detail, fix) => results.push({ level: 'warn', name, detail, fix });
const fail = (name, detail, fix) => results.push({ level: 'fail', name, detail, fix });

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.error || r.status === null) {
    return null;
  }
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
}

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

// ---------------------------------------------------------------------------
// Node.js
// ---------------------------------------------------------------------------
{
  const major = Number(process.versions.node.split('.')[0]);
  const min = versions.node.minimumMajor;
  if (major >= min) {
    pass('Node.js', `v${process.versions.node}`);
  } else {
    fail(
      'Node.js',
      `v${process.versions.node} is too old (need >= ${min})`,
      `Install Node ${versions.node.recommended} LTS - see docs/PREREQUISITES.md#nodejs`,
    );
  }
}

// ---------------------------------------------------------------------------
// Java - needed only because the Grid hub and nodes are Java processes
// ---------------------------------------------------------------------------
{
  const out = run('java', ['-version']);
  if (!out) {
    fail(
      'Java',
      'not found on PATH',
      `Install Java ${versions.java.recommended} - see docs/PREREQUISITES.md#java`,
    );
  } else {
    // Matches both `openjdk version "17.0.9"` and legacy `version "1.8.0_401"`.
    const m = out.match(/version "(\d+)(?:\.(\d+))?/);
    const major = m ? (m[1] === '1' ? Number(m[2]) : Number(m[1])) : NaN;
    const line = out.split('\n')[0];
    if (Number.isNaN(major)) {
      warn('Java', `present but version unparseable: ${line}`, 'Check `java -version` manually');
    } else if (major >= versions.java.minimumMajor) {
      pass('Java', line);
    } else {
      fail(
        'Java',
        `Java ${major} is too old (Selenium Grid needs >= ${versions.java.minimumMajor})`,
        `Install Java ${versions.java.recommended} - see docs/PREREQUISITES.md#java`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Google Chrome - the Grid nodes drive real Chrome, and Playwright's Grid
// integration is Chromium/Chrome-only.
// ---------------------------------------------------------------------------
{
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    ],
  }[process.platform] ?? [];

  let found = null;
  for (const p of candidates) {
    if (await exists(p)) {
      found = p;
      break;
    }
  }
  if (found) {
    pass('Google Chrome', found);
  } else {
    fail(
      'Google Chrome',
      'not found in the usual locations',
      'Install Google Chrome - see docs/PREREQUISITES.md#google-chrome',
    );
  }
}

// ---------------------------------------------------------------------------
// Downloaded tooling
// ---------------------------------------------------------------------------
{
  const jar = path.join(ROOT, 'vendor', versions.selenium.jar);
  if (await exists(jar)) {
    pass('Selenium Server jar', `vendor/${versions.selenium.jar}`);
  } else {
    fail('Selenium Server jar', 'missing', 'Run `npm run setup`');
  }

  const promBin = path.join(
    ROOT,
    'vendor/prometheus',
    process.platform === 'win32' ? 'prometheus.exe' : 'prometheus',
  );
  if (await exists(promBin)) {
    pass('Prometheus', 'vendor/prometheus');
  } else {
    fail('Prometheus', 'missing', 'Run `npm run setup`');
  }

  if (await exists(path.join(ROOT, 'node_modules/@playwright/test'))) {
    pass('Playwright', `@playwright/test ${versions.playwright.version}`);
  } else {
    fail('Playwright', 'node_modules missing', 'Run `npm ci`');
  }
}

// ---------------------------------------------------------------------------
// Ports - a stale process from an earlier run is the #1 cause of weird failures
// ---------------------------------------------------------------------------
{
  const g = versions.grid;
  const ports = [
    [g.hubPort, 'Grid hub'],
    [g.eventPublishPort, 'Grid event bus (publish)'],
    [g.eventSubscribePort, 'Grid event bus (subscribe)'],
    ...g.nodePorts.map((p, i) => [p, `Grid node ${i + 1}`]),
    [g.exporterPort, 'Metrics exporter'],
    [g.prometheusPort, 'Prometheus'],
    [g.appPort, 'Demo app'],
  ];

  const busy = [];
  for (const [port, label] of ports) {
    if (!(await portFree(port))) {
      busy.push(`${port} (${label})`);
    }
  }
  if (busy.length === 0) {
    pass('Ports', `all ${ports.length} required ports are free`);
  } else {
    warn('Ports', `in use: ${busy.join(', ')}`, 'Run `npm run stop` to clear stale processes');
  }
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
{
  // Reporting installed RAM rather than os.freemem(): on macOS the "free"
  // figure excludes reclaimable cache and reads alarmingly low on a healthy
  // machine. Total is the number that actually predicts whether 3 nodes fit.
  const totalGb = os.totalmem() / 1024 ** 3;
  const cpus = os.availableParallelism?.() ?? os.cpus().length;
  const detail = `${totalGb.toFixed(1)} GB installed, ${cpus} CPUs`;
  if (totalGb < 7.5) {
    warn('Memory', detail, 'Below 8 GB: start 2 nodes instead of 3 (see docs/SETUP.md)');
  } else {
    pass('Memory', detail);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(`\n${c.bold('Workshop environment check')}  ${c.dim(`${process.platform}/${os.arch()}`)}\n`);

const icon = { pass: c.green('  ok  '), warn: c.yellow(' warn '), fail: c.red(' FAIL ') };
for (const r of results) {
  console.log(`${icon[r.level]} ${r.name.padEnd(20)} ${c.dim(r.detail)}`);
  if (r.fix) {
    console.log(`       ${' '.repeat(20)} ${c.yellow('-> ' + r.fix)}`);
  }
}

const failed = results.filter((r) => r.level === 'fail');
const warned = results.filter((r) => r.level === 'warn');

console.log();
if (failed.length === 0 && warned.length === 0) {
  console.log(c.green(c.bold('All checks passed. You are ready for the workshop.')));
} else if (failed.length === 0) {
  console.log(c.yellow(c.bold(`Ready, with ${warned.length} warning(s) - see above.`)));
} else {
  console.log(c.red(c.bold(`${failed.length} blocking problem(s).`)), 'Fix these before the workshop.');
  process.exitCode = 1;
}
