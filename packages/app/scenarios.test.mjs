/**
 * Scenario tests for the seat-booking API.
 *
 *   node --test app/scenarios.test.mjs
 *
 * These assert the properties the whole workshop rests on: the planted
 * failures reproduce in every execution order, and only under the conditions
 * we intend. Requires the app to be running on port 3000.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.APP_URL ?? 'http://localhost:3000';
const SHARED = 's1';
const CONTENDED_SEAT = 26;

const send = async (method, path, data) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
};

const get = (path) => send('GET', path);
const post = (path, data) => send('POST', path, data ?? {});
const del = (path) => send('DELETE', path);

const setWorkers = (workers) => post('/api/_test/config', { workers });
const reset = () => post('/api/_test/reset');
const screening = (id = SHARED) => get(`/api/screenings/${id}`);
const bookSeat = (seat, who, id = SHARED) => post(`/api/screenings/${id}/seats/${seat}?who=${who}`);
const releaseSeat = (seat, id = SHARED) => del(`/api/screenings/${id}/seats/${seat}`);
const bookBlock = (count, who, id = SHARED) => post(`/api/screenings/${id}/seats?who=${who}`, { count });

const seatHolder = (body, seat) => body.seats.find((s) => s.seat === seat).who;

// Every test states the kind of run it is simulating, because the harness
// behaves differently in each and inheriting it from the previous test would
// make these results depend on their own execution order.
const serial = async () => {
  await setWorkers(1);
  await reset();
};
const parallel = async () => {
  await setWorkers(6);
  await reset();
};

// ---------------------------------------------------------------------------
// The shared screening
// ---------------------------------------------------------------------------

test('a reset screening has fifty free seats', async () => {
  await serial();

  const { body } = await screening();
  assert.equal(body.seatCount, 50);
  assert.equal(body.freeCount, 50);
  assert.equal(body.rows * body.columns, 50);
  assert.equal(body.startsAt, '2026-03-15T23:30:00Z');
  assert.equal(body.priceEur, 12.5);
});

test('booking a seat takes it and drops the free count', async () => {
  await serial();

  const { status, body } = await bookSeat(CONTENDED_SEAT, 'alice');
  assert.equal(status, 201);
  assert.equal(body.seat, CONTENDED_SEAT);
  assert.equal(body.who, 'alice');
  assert.match(body.id, /^BKG-\d{4}$/);

  const { body: after } = await screening();
  assert.equal(after.freeCount, 49);
  assert.equal(seatHolder(after, CONTENDED_SEAT), 'alice');
});

test('booking a taken seat is a clean conflict', async () => {
  await serial();
  await bookSeat(CONTENDED_SEAT, 'alice');

  const { status, body } = await bookSeat(CONTENDED_SEAT, 'bob');
  assert.equal(status, 409);
  assert.equal(body.who, 'alice', 'the conflict should name who actually holds the seat');

  const { body: after } = await screening();
  assert.equal(seatHolder(after, CONTENDED_SEAT), 'alice');
});

test('releasing a seat frees it, and releasing a free seat is harmless', async () => {
  await serial();
  await bookSeat(CONTENDED_SEAT, 'alice');

  const { status, body } = await releaseSeat(CONTENDED_SEAT);
  assert.equal(status, 200);
  assert.equal(body.released, 'alice');

  const { body: again } = await releaseSeat(CONTENDED_SEAT);
  assert.equal(again.released, null, 'release must be idempotent, so a test can arrange with it');

  const { body: after } = await screening();
  assert.equal(after.freeCount, 50);
});

test('seat numbers outside the auditorium are rejected', async () => {
  await serial();
  assert.equal((await bookSeat(0, 'alice')).status, 400);
  assert.equal((await bookSeat(51, 'alice')).status, 400);
});

// ---------------------------------------------------------------------------
// Block booking - the perpetrator's half of planted failure 1
// ---------------------------------------------------------------------------

test('a party of three lands in the middle of the middle row', async () => {
  await serial();

  const { status, body } = await bookBlock(3, 'bob');
  assert.equal(status, 201);
  assert.deepEqual(
    body.seats.map((s) => s.seat),
    [24, 25, 26],
    'the best block must include the contended seat, on every machine',
  );
});

test('a party of three routes around seats that are already taken', async () => {
  await serial();
  await bookSeat(CONTENDED_SEAT, 'alice');

  const { body } = await bookBlock(3, 'bob');
  const seats = body.seats.map((s) => s.seat);
  assert.ok(!seats.includes(CONTENDED_SEAT), 'the block booker must not need a free seat 26');
  assert.equal(seats.length, 3);

  const { body: after } = await screening();
  assert.equal(seatHolder(after, CONTENDED_SEAT), 'alice', 'and must not disturb the seat it skipped');
});

test('a party larger than a row cannot be seated', async () => {
  await serial();
  assert.equal((await bookBlock(11, 'bob')).status, 400);
});

// ---------------------------------------------------------------------------
// Planted failure 1 - the block booking overwrites a seat somebody just took
//
// The property that matters: the outcome depends on the worker count and
// nothing else. Every arrival order has to produce the same victim.
// ---------------------------------------------------------------------------

test('serial: the two bookings take turns, and nothing is delayed', async () => {
  await serial();

  const started = Date.now();
  await bookSeat(CONTENDED_SEAT, 'alice');
  const { body } = await bookBlock(3, 'bob');
  const elapsed = Date.now() - started;

  const { body: after } = await screening();
  assert.equal(seatHolder(after, CONTENDED_SEAT), 'alice', 'alice keeps the seat she booked');
  assert.ok(!body.seats.some((s) => s.seat === CONTENDED_SEAT), 'bob is seated elsewhere');
  assert.ok(elapsed < 500, `a serial run must not be slowed by the harness, took ${elapsed}ms`);
});

test('serial, block booking first: still no collision', async () => {
  await serial();

  await bookBlock(3, 'bob');
  // Alice arranges the seat she wants, exactly as a test would.
  await releaseSeat(CONTENDED_SEAT);
  const { status } = await bookSeat(CONTENDED_SEAT, 'alice');

  assert.equal(status, 201, 'the arrange must survive whichever spec file ran first');
  const { body: after } = await screening();
  assert.equal(seatHolder(after, CONTENDED_SEAT), 'alice');
});

test('parallel, single booking issued first: the block booking overwrites it', async () => {
  await parallel();

  const [single, block] = await Promise.all([bookSeat(CONTENDED_SEAT, 'alice'), bookBlock(3, 'bob')]);

  assert.equal(single.status, 201, 'alice is told she got the seat');
  assert.deepEqual(
    block.body.seats.map((s) => s.seat),
    [24, 25, 26],
    'bob chose his seats before alice committed hers',
  );

  const { body: after } = await screening();
  assert.equal(seatHolder(after, CONTENDED_SEAT), 'bob', 'and alice lost it without being told');
});

test('parallel, block booking issued first: the collision still reproduces', async () => {
  await parallel();

  // The ordering a naive barrier gets wrong: the block booking is already in
  // flight before the victim's request exists.
  const blocking = bookBlock(3, 'bob');
  const single = await bookSeat(CONTENDED_SEAT, 'alice');
  await blocking;

  assert.equal(single.status, 201);
  const { body: after } = await screening();
  assert.equal(seatHolder(after, CONTENDED_SEAT), 'bob', 'the victim must not depend on arrival order');
});

test('parallel: by the time the victim is answered, its seat is already gone', async () => {
  await parallel();

  const blocking = bookBlock(3, 'bob');
  const single = await bookSeat(CONTENDED_SEAT, 'alice');
  // The victim's very next look at the seat map, which is what its browser
  // does the instant the 201 arrives.
  const { body: asTheVictimSeesIt } = await screening();
  await blocking;

  assert.equal(single.status, 201);
  assert.equal(
    seatHolder(asTheVictimSeesIt, CONTENDED_SEAT),
    'bob',
    'the symptom has to be visible to the victim, not only to a later reader',
  );
});

test('parallel: the rendezvous settles promptly once both requests are in flight', async () => {
  await parallel();

  const started = Date.now();
  await Promise.all([bookSeat(CONTENDED_SEAT, 'alice'), bookBlock(3, 'bob')]);
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 2000, `neither half may wait on the other's response, took ${elapsed}ms`);
});

test('the perpetrator always succeeds', async () => {
  await parallel();

  const [, block] = await Promise.all([bookSeat(CONTENDED_SEAT, 'alice'), bookBlock(3, 'bob')]);

  assert.equal(block.status, 201, 'the test that causes the bug sees nothing but success');
  assert.equal(block.body.seats.length, 3);
});

test('a screening of your own is never held up', async () => {
  await parallel();

  const { body: mine } = await post('/api/screenings');
  const started = Date.now();
  const { status } = await bookSeat(CONTENDED_SEAT, 'carol', mine.id);
  const elapsed = Date.now() - started;

  assert.equal(status, 201);
  assert.ok(elapsed < 500, `the fixed test must not wait for a rival that cannot exist, took ${elapsed}ms`);
});

test('the handover seat is never held up', async () => {
  await parallel();

  const started = Date.now();
  const { status } = await bookSeat(44, 'dana');
  const elapsed = Date.now() - started;

  assert.equal(status, 201);
  assert.ok(elapsed < 500, `only seat ${CONTENDED_SEAT} is contended, took ${elapsed}ms`);
});

// ---------------------------------------------------------------------------
// Recent bookings - the side effect behind the order-dependency exercise
// ---------------------------------------------------------------------------

test('recent bookings are newest first and scoped to their screening', async () => {
  await serial();
  await bookSeat(1, 'dana');
  await bookSeat(2, 'erin');

  const { body } = await get(`/api/screenings/${SHARED}/bookings`);
  assert.deepEqual(
    body.bookings.map((b) => b.who),
    ['erin', 'dana'],
  );

  const { body: own } = await post('/api/screenings');
  const { body: theirs } = await get(`/api/screenings/${own.id}/bookings`);
  assert.deepEqual(theirs.bookings, [], 'a fresh screening starts with no history');
});

// ---------------------------------------------------------------------------
// Owning your own data - the fix for planted failure 1
// ---------------------------------------------------------------------------

test('a screening of your own is independent of the shared one', async () => {
  await serial();
  await bookSeat(CONTENDED_SEAT, 'alice');

  const { status, body: mine } = await post('/api/screenings');
  assert.equal(status, 201);
  assert.notEqual(mine.id, SHARED);
  assert.equal(mine.freeCount, 50, 'nobody else has booked here');

  const { status: booked } = await bookSeat(CONTENDED_SEAT, 'carol', mine.id);
  assert.equal(booked, 201, 'the same seat number is free on a different screening');

  const { body: shared } = await screening();
  assert.equal(seatHolder(shared, CONTENDED_SEAT), 'alice', 'and the shared screening is untouched');
});

test('unknown screenings are a 404, not a crash', async () => {
  assert.equal((await screening('nope')).status, 404);
  assert.equal((await bookSeat(1, 'alice', 'nope')).status, 404);
  assert.equal((await get('/api/screenings/nope/bookings')).status, 404);
});
