/**
 * Deciding whether a process belongs to this workshop.
 *
 * Extracted into its own module so it can be unit tested against fabricated
 * command lines. Getting this wrong means a cleanup script that kills the
 * terminal it was launched from, so it is worth testing properly.
 */

import path from 'node:path';

/** Command-line fragments that identify a Grid component. */
export const GRID_PATTERNS = ['selenium-server', 'chromedriver'];

/** Command-line fragments for the supporting processes. */
export const OTHER_PATTERNS = [
  path.join('vendor', 'prometheus'),
  path.join('packages', 'app', 'server.mjs'),
  path.join('tools', 'grid-exporter.mjs'),
];

/** chromedriver always adds these; a user's own Chrome never has both. */
export const CHROME_AUTOMATION_MARKERS = ['--test-type', '--remote-debugging-port'];

/**
 * Only these executables are ever candidates for killing.
 *
 * Without this gate, matching on the command line alone is dangerous: a shell
 * running `pkill -f vendor/prometheus` has "vendor/prometheus" in its own
 * command line and would match itself. That is how a cleanup script ends up
 * killing the terminal you ran it from.
 */
export const KILLABLE_EXECUTABLES = [
  'java',
  'node',
  'chromedriver',
  'prometheus',
  'chrome',
  'chromium',
  'chromium-browser',
  'google chrome',
  'google chrome for testing',
  'google-chrome',
  'google-chrome-stable',
];

/**
 * Basename of a path, lowercased and stripped of any .exe suffix.
 *
 * Splits on both separators regardless of the host platform, because a Windows
 * process list has to be parsed correctly whether or not `path` happens to be
 * in win32 mode.
 */
function basenameOf(p) {
  return (p.split(/[/\\]/).pop() ?? '').replace(/\.exe$/i, '').toLowerCase();
}

/**
 * Plausible executable names for a command line.
 *
 * Returns more than one candidate because an unquoted argv[0] cannot be
 * located unambiguously: on macOS, Chrome lives at
 * ".../MacOS/Google Chrome" - the executable name itself contains a space, so
 * splitting on whitespace yields "google". We therefore also try the prefix
 * before the first flag-looking argument, and treat the process as a match if
 * any candidate is recognised.
 */
export function executableCandidates(cmd) {
  const trimmed = cmd.trim();
  if (!trimmed) {
    return [];
  }

  const quoted = trimmed.match(/^"([^"]+)"/);
  if (quoted) {
    return [basenameOf(quoted[1])].filter(Boolean);
  }

  const candidates = [trimmed.split(/\s+/)[0] ?? ''];
  const beforeFirstFlag = trimmed.split(/\s+-/)[0];
  if (beforeFirstFlag && beforeFirstFlag !== candidates[0]) {
    candidates.push(beforeFirstFlag);
  }

  return [...new Set(candidates.map(basenameOf))].filter(Boolean);
}

/**
 * @param {string} cmd       full command line of the process
 * @param {object} [options]
 * @param {boolean} [options.gridOnly]  ignore the app, exporter and Prometheus
 */
export function isOurs(cmd, { gridOnly = false } = {}) {
  if (!cmd || !cmd.trim()) {
    return false;
  }

  const candidates = executableCandidates(cmd);
  const recognised = candidates.filter((e) => KILLABLE_EXECUTABLES.includes(e));
  if (recognised.length === 0) {
    return false;
  }

  const patterns = gridOnly ? GRID_PATTERNS : [...GRID_PATTERNS, ...OTHER_PATTERNS];
  if (patterns.some((p) => cmd.includes(p))) {
    return true;
  }

  // Automation-launched Chrome needs every marker present, so a human's
  // ordinary browser window is never a match.
  const looksLikeChrome = recognised.some((e) => /chrome|chromium/.test(e));
  return looksLikeChrome && CHROME_AUTOMATION_MARKERS.every((m) => cmd.includes(m));
}
