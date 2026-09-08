#!/usr/bin/env node
/**
 * One-command setup: downloads everything the workshop needs into vendor/.
 *
 * Deliberately zero-dependency and cross-platform so attendees never hit a
 * "works on brew but not winget" wall. Run this on good wifi BEFORE the
 * workshop - it pulls ~150 MB (Selenium jar, Prometheus, Chromium).
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, readdir, rename, chmod } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');

const versions = JSON.parse(await readFile(path.join(ROOT, 'config/versions.json'), 'utf8'));

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function step(msg) {
  console.log(`\n${c.bold('==>')} ${msg}`);
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const total = Number(res.headers.get('content-length') ?? 0);
  let seen = 0;
  let lastPrint = 0;

  const progress = new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      const now = Date.now();
      if (now - lastPrint > 250) {
        lastPrint = now;
        const mb = (seen / 1024 / 1024).toFixed(1);
        const pct = total ? ` (${Math.round((seen / total) * 100)}%)` : '';
        process.stdout.write(`\r    ${mb} MB${pct}   `);
      }
      controller.enqueue(chunk);
    },
  });

  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  await pipeline(res.body.pipeThrough(progress), createWriteStream(tmp));
  await rename(tmp, dest);
  process.stdout.write('\r');
}

/** Prometheus publishes per-platform archives; map Node's identifiers onto theirs. */
function prometheusTarget() {
  const platform = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
  const arch = { x64: 'amd64', arm64: 'arm64' }[os.arch()];
  if (!platform || !arch) {
    return null;
  }
  const ext = platform === 'windows' ? 'zip' : 'tar.gz';
  const version = versions.prometheus.version;
  const name = `prometheus-${version}.${platform}-${arch}`;
  const url = versions.prometheus.urlTemplate
    .replaceAll('{version}', version)
    .replaceAll('{os}', platform)
    .replaceAll('{arch}', arch)
    .replaceAll('{ext}', ext);
  return { url, name, ext };
}

async function extract(archive, intoDir) {
  await mkdir(intoDir, { recursive: true });
  // tar is present on macOS, Linux and Windows 10+ (bsdtar), and handles zip too.
  const result = spawnSync('tar', ['-xf', archive, '-C', intoDir], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${archive}. Extract it manually into ${intoDir}.`);
  }
}

let failures = 0;

// ---------------------------------------------------------------------------
// 1. Selenium Grid server jar
// ---------------------------------------------------------------------------
step(`Selenium Server ${versions.selenium.version}`);
const jarPath = path.join(VENDOR, versions.selenium.jar);
if (await exists(jarPath)) {
  console.log(c.green('    already present'), c.dim(jarPath));
} else {
  try {
    await download(versions.selenium.url, jarPath);
    console.log(c.green('    downloaded'), c.dim(jarPath));
  } catch (err) {
    failures++;
    console.log(c.red(`    FAILED: ${err.message}`));
    console.log(c.dim(`    Manual fallback: download ${versions.selenium.url}`));
    console.log(c.dim(`    and save it to ${jarPath}`));
  }
}

// ---------------------------------------------------------------------------
// 2. Prometheus
// ---------------------------------------------------------------------------
step(`Prometheus ${versions.prometheus.version}`);
const target = prometheusTarget();
const promDir = path.join(VENDOR, 'prometheus');
const promBin = path.join(promDir, process.platform === 'win32' ? 'prometheus.exe' : 'prometheus');

if (await exists(promBin)) {
  console.log(c.green('    already present'), c.dim(promBin));
} else if (!target) {
  failures++;
  console.log(c.red(`    Unsupported platform ${process.platform}/${os.arch()}`));
} else {
  try {
    const archive = path.join(VENDOR, `${target.name}.${target.ext}`);
    if (!(await exists(archive))) {
      await download(target.url, archive);
    }
    const staging = path.join(VENDOR, '.prom-staging');
    await rm(staging, { recursive: true, force: true });
    await extract(archive, staging);

    // Archives contain a single versioned top-level directory; flatten it.
    const [inner] = await readdir(staging);
    await rm(promDir, { recursive: true, force: true });
    await rename(path.join(staging, inner), promDir);
    await rm(staging, { recursive: true, force: true });
    await rm(archive, { force: true });

    if (process.platform !== 'win32') {
      await chmod(promBin, 0o755);
    }
    console.log(c.green('    installed'), c.dim(promDir));
  } catch (err) {
    failures++;
    console.log(c.red(`    FAILED: ${err.message}`));
    console.log(c.dim(`    Manual fallback: download ${target.url}`));
    console.log(c.dim(`    extract it, and rename the folder to ${promDir}`));
  }
}

// ---------------------------------------------------------------------------
// 3. Playwright browsers
// ---------------------------------------------------------------------------
// The local baseline run uses Playwright's bundled Chromium. The grid runs use
// Chrome on the Selenium nodes, but we still need the local browser for the
// "works on my machine" comparison in the first part of the workshop.
step('Playwright browsers (chromium)');
if (await exists(path.join(ROOT, 'node_modules/@playwright/test'))) {
  const result = spawnSync('npx', ['playwright', 'install', 'chromium'], {
    stdio: 'inherit',
    cwd: ROOT,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    failures++;
    console.log(c.red('    FAILED: `npx playwright install chromium` returned non-zero'));
  }
} else {
  failures++;
  console.log(c.yellow('    skipped: run `npm ci` first, then re-run `npm run setup`'));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log();
if (failures === 0) {
  console.log(c.green(c.bold('Setup complete.')), 'Next: npm run doctor');
} else {
  console.log(c.red(c.bold(`Setup finished with ${failures} problem(s).`)));
  console.log('See docs/SETUP.md#troubleshooting for the manual fallbacks.');
  process.exitCode = 1;
}
