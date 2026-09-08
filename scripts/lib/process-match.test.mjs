/**
 * Tests for the process classifier used by `npm run stop`.
 *
 *   node --test scripts/lib/
 *
 * These run against fabricated command-line strings, so nothing on the machine
 * is inspected or signalled.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { isOurs, executableCandidates } from './process-match.mjs';

const OURS = [
  ['grid hub', '/usr/bin/java -jar vendor/selenium-server-4.48.0.jar hub --host localhost'],
  ['grid node', 'java -jar /repo/vendor/selenium-server-4.48.0.jar node --port 5570'],
  ['chromedriver', '/Users/x/.cache/selenium/chromedriver/mac-arm64/142/chromedriver --port=52123'],
  ['prometheus', './vendor/prometheus/prometheus --config.file=config/prometheus.yml'],
  ['demo app', 'node /repo/packages/app/server.mjs'],
  ['exporter', 'node /repo/tools/grid-exporter.mjs'],
  [
    'automation chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --test-type --remote-debugging-port=53001 --user-data-dir=/tmp/x',
  ],
  [
    'automation chrome, quoted windows path',
    '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --test-type --remote-debugging-port=53001',
  ],
];

const NOT_OURS = [
  // The regression this gate exists for: a shell that merely mentions our
  // paths in its own arguments.
  ['shell running pkill', '/bin/zsh -c pkill -f "vendor/prometheus/prometheus"'],
  ['shell mentioning everything', '/bin/bash -c sleep 25 # vendor/prometheus chromedriver selenium-server-4.48.0.jar'],
  ['grep for our jar', 'grep -r selenium-server-4.48.0.jar .'],
  ['editor with our file open', '/Applications/Cursor.app/Contents/MacOS/Cursor /repo/tools/grid-exporter.mjs'],

  // A human's actual browser: no automation flags.
  ['user chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  [
    'user chrome renderer',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=renderer --remote-debugging-port=0',
  ],

  // Unrelated processes on the same runtimes.
  ['unrelated java', '/usr/bin/java -jar /opt/some-other-app.jar'],
  ['unrelated node', 'node /repo/other-project/index.js'],
  ['empty', ''],
];

test('classifies workshop processes as ours', () => {
  for (const [label, cmd] of OURS) {
    assert.equal(isOurs(cmd), true, `expected to match: ${label}`);
  }
});

test('never classifies unrelated processes as ours', () => {
  for (const [label, cmd] of NOT_OURS) {
    assert.equal(isOurs(cmd), false, `expected NOT to match: ${label}`);
  }
});

test('gridOnly mode leaves the app, exporter and Prometheus alone', () => {
  const hub = 'java -jar vendor/selenium-server-4.48.0.jar hub';
  const prom = './vendor/prometheus/prometheus --config.file=config/prometheus.yml';
  const exporter = 'node /repo/tools/grid-exporter.mjs';

  assert.equal(isOurs(hub, { gridOnly: true }), true);
  assert.equal(isOurs(prom, { gridOnly: true }), false);
  assert.equal(isOurs(exporter, { gridOnly: true }), false);
});

test('executableCandidates handles plain, absolute, quoted and spaced paths', () => {
  const has = (cmd, expected) =>
    assert.ok(
      executableCandidates(cmd).includes(expected),
      `expected ${JSON.stringify(executableCandidates(cmd))} to include "${expected}"`,
    );

  has('java -jar x.jar', 'java');
  has('/usr/bin/java -jar x.jar', 'java');
  has('node /repo/packages/app/server.mjs', 'node');
  has('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --x', 'chrome');
  // The macOS case that whitespace splitting alone gets wrong.
  has('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --test-type', 'google chrome');
  has('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'google chrome');

  assert.deepEqual(executableCandidates(''), []);
});
