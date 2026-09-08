/**
 * The determinism harness for planted failure 1.
 *
 * WHY THIS EXISTS
 *
 * Failure 1 is a lost update: a block booking checks which seats are free,
 * pauses, and then takes them without looking again. If a single booking
 * lands on one of those seats during the pause, the block booking overwrites
 * it and the person who booked first silently loses their seat.
 *
 * The bug itself lives in the server's block-booking handler and is always
 * present. What is *not* always present is the overlap: two Playwright workers
 * queueing for Grid slots can start many seconds apart, so in the wild this
 * fails maybe one run in twenty. One run in twenty is useless for teaching,
 * and worse, it is exactly the kind of flake a team learns to retry past.
 *
 * So this file removes the luck. It does not invent the bug. All it does is
 * guarantee the two requests overlap whenever the suite runs in parallel, and
 * never when it runs serially.
 *
 * Show this file to attendees during the debrief. The honest framing lands far
 * better than a magic trick:
 *
 *   "I made this fail reliably. In your codebase it fails one run in twenty,
 *    which is worse, because you retry the build and move on."
 *
 * HOW IT WORKS
 *
 * The order of the two operations decides whether the bug reproduces, so a
 * plain "wait for two parties" barrier is not enough:
 *
 *   - if the single booking commits before the block booking picks its seats,
 *     the block booker simply routes around it and nothing goes wrong;
 *   - if the block booking commits before the single booking arrives, the
 *     single booking gets an honest 409 and nothing goes wrong either.
 *
 * The bug needs the single booking to land *between* the block booker's check
 * and its write. So the two handlers rendezvous:
 *
 *   1. single booking  POST /api/screenings/s1/seats/26
 *                          -> waitForBlockChoice(): park, and wake any block
 *                             booking already waiting for a rival
 *   2. block booking   POST /api/screenings/s1/seats
 *                          -> holdForRivalBooking(): wait until a single
 *                             booking is parked, then release it
 *   3. single booking      -> commits seat 26
 *   4. block booking       -> sleeps out the race window, then overwrites it,
 *                             then announceBlockWrite()
 *   5. single booking      -> waitForRivalWrite(): only now does its 201 go
 *                             back to the caller
 *
 * Whichever request arrives first waits for the other, so the outcome does not
 * depend on Grid scheduling. Step 4 always happens last, which means the same
 * test is the victim every time and every attendee sees the same red line.
 *
 * WHY STEP 5 EXISTS
 *
 * Steps 1 to 4 make the *bug* deterministic. They do not make the *symptom*
 * deterministic, and a browser can only see the symptom.
 *
 * The victim's page redraws the moment its 201 arrives. Without step 5 that
 * redraw lands inside the block booker's race window, when seat 26 genuinely
 * still is hers. The overwrite follows milliseconds later, the page never
 * looks again, and a test that lost its seat goes green - which was measured,
 * not guessed. So the victim's answer is held until the overwrite has landed,
 * and the next thing it looks at is the truth.
 *
 * Only the booking that actually met a rival waits: step 5 takes the reason
 * returned by step 1, so a booking that timed out, or that never had a rival
 * to begin with, returns immediately.
 *
 * WHY IT NEEDS THE WORKER COUNT
 *
 * The waits must be long enough to cover Playwright workers queueing for Grid
 * slots - with six workers and three slots, two colliding tests can start many
 * seconds apart. But a long wait in a *serial* run would stall every run for
 * no reason, because there is no second participant coming.
 *
 * Rather than guess with a middling timeout that is wrong in both directions,
 * the runner tells us the worker count in global setup
 * (POST /api/_test/config). One worker means no collision is possible, so the
 * waits are skipped entirely and the serial run is fast. More than one means a
 * collision is guaranteed to happen, so we can afford to wait properly for it.
 */

import { CONTENDED_SEAT, SHARED_SCREENING_ID } from './state.mjs';

/**
 * How long to wait for the other participant when running in parallel.
 *
 * Generous on purpose: it has to cover a worker sitting in the Grid's session
 * queue. It is never reached in a serial run, because the waits are skipped.
 *
 * A suite where the victim has been *fixed* - where it books on a screening of
 * its own - has no second participant either, so the block booking pays this
 * timeout once. That is the correct trade: a slower green run is much cheaper
 * than an unreliable red one.
 */
export const PARALLEL_WAIT_MS = 20_000;

/** Single bookings parked on a contended seat. @type {Map<string, Set<Function>>} */
const parkedSingles = new Map();

/** Block bookings waiting for a single booking to show up. @type {Map<string, Set<Function>>} */
const rivalWaiters = new Map();

/** Committed single bookings waiting to be overwritten. @type {Map<string, Set<Function>>} */
const writeWaiters = new Map();

/** Seats a block booking has already taken, so a late waiter never hangs. @type {Set<string>} */
const blockWritesDone = new Set();

/** Worker count reported by the test runner. 1 means serial. */
let concurrency = 1;

/** Set from Playwright's global setup via POST /api/_test/config. */
export function setConcurrency(workers) {
  concurrency = Number.isFinite(workers) && workers > 0 ? Math.floor(workers) : 1;
  return concurrency;
}

export function getConcurrency() {
  return concurrency;
}

/**
 * True when a collision is possible for this seat at all.
 *
 * Scoped to the one contended seat on the one shared screening, on purpose. A
 * test that creates its own screening has no competing booker by definition -
 * which is exactly the fix for this failure - so it must never be held up
 * waiting for one. Neither must a test working on any other seat, which is
 * what keeps the order-dependency exercise on seat 44 running at full speed.
 */
function collisionPossible(screeningId, seat) {
  return concurrency > 1 && screeningId === SHARED_SCREENING_ID && seat === CONTENDED_SEAT;
}

const keyFor = (screeningId, seat) => `${screeningId}:${seat}`;

function park(registry, key, settle) {
  let waiters = registry.get(key);
  if (!waiters) {
    waiters = new Set();
    registry.set(key, waiters);
  }
  waiters.add(settle);
}

function releaseAll(registry, key, reason) {
  const waiters = registry.get(key);
  if (!waiters) {
    return false;
  }
  registry.delete(key);
  for (const settle of waiters) {
    settle(reason);
  }
  return true;
}

/**
 * Step 1: hold a single booking until a block booking has picked its seats.
 *
 * Serial   - skipped entirely, so the booking is immediate and the test passes.
 * Parallel - returns the moment a block booker has chosen, so this booking
 *            commits into the gap between that choice and its write.
 */
export function waitForBlockChoice(screeningId, seat) {
  if (!collisionPossible(screeningId, seat)) {
    return Promise.resolve('no-collision');
  }

  const key = keyFor(screeningId, seat);
  return new Promise((resolve) => {
    const settle = (reason) => {
      clearTimeout(timer);
      parkedSingles.get(key)?.delete(settle);
      resolve(reason);
    };
    const timer = setTimeout(() => settle('timeout'), PARALLEL_WAIT_MS);

    park(parkedSingles, key, settle);
    // Wake a block booking that got here first and is waiting for us.
    releaseAll(rivalWaiters, key, 'rival-arrived');
  });
}

/**
 * Step 2: hold a block booking until a single booking is parked on one of its
 * seats, then let that booking commit.
 *
 * The block booking has already chosen its seats by the time this is called,
 * which is the whole point: the choice is made before the rival commits, and
 * the write happens after.
 */
export function holdForRivalBooking(screeningId, block) {
  if (!block.includes(CONTENDED_SEAT) || !collisionPossible(screeningId, CONTENDED_SEAT)) {
    return Promise.resolve('no-collision');
  }

  const key = keyFor(screeningId, CONTENDED_SEAT);
  const releaseRival = (reason) => {
    releaseAll(parkedSingles, key, 'block-chosen');
    return reason;
  };

  if (parkedSingles.get(key)?.size) {
    return Promise.resolve(releaseRival('rival-already-waiting'));
  }

  return new Promise((resolve) => {
    const settle = (reason) => {
      clearTimeout(timer);
      rivalWaiters.get(key)?.delete(settle);
      resolve(releaseRival(reason));
    };
    const timer = setTimeout(() => settle('timeout'), PARALLEL_WAIT_MS);

    park(rivalWaiters, key, settle);
  });
}

/**
 * Step 4b: the block booking has taken its seats. Anyone whose seat just
 * disappeared can now be told they got it.
 */
export function announceBlockWrite(screeningId, block) {
  if (!block.includes(CONTENDED_SEAT) || !collisionPossible(screeningId, CONTENDED_SEAT)) {
    return;
  }

  const key = keyFor(screeningId, CONTENDED_SEAT);
  blockWritesDone.add(key);
  releaseAll(writeWaiters, key, 'block-written');
}

/**
 * Step 5: hold a committed single booking's response until the block booking
 * has overwritten its seat, so that whatever the caller looks at next shows
 * what actually happened. See WHY STEP 5 EXISTS above.
 *
 * `rendezvous` is the reason returned by waitForBlockChoice. Anything other
 * than a real handover means there is no rival to wait for.
 */
export function waitForRivalWrite(screeningId, seat, rendezvous) {
  if (rendezvous !== 'block-chosen' || !collisionPossible(screeningId, seat)) {
    return Promise.resolve('no-rival');
  }

  const key = keyFor(screeningId, seat);
  if (blockWritesDone.has(key)) {
    return Promise.resolve('already-written');
  }

  return new Promise((resolve) => {
    const settle = (reason) => {
      clearTimeout(timer);
      writeWaiters.get(key)?.delete(settle);
      resolve(reason);
    };
    const timer = setTimeout(() => settle('timeout'), PARALLEL_WAIT_MS);

    park(writeWaiters, key, settle);
  });
}

/**
 * Called by POST /api/_test/reset.
 *
 * Deliberately keeps `concurrency`: that is a property of the run, set once in
 * global setup, not of the data.
 */
export function reset() {
  for (const registry of [parkedSingles, rivalWaiters, writeWaiters]) {
    for (const key of [...registry.keys()]) {
      releaseAll(registry, key, 'reset');
    }
  }
  blockWritesDone.clear();
}
