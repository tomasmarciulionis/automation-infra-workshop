#!/usr/bin/env node
/**
 * Odeon Seats - the workshop's test target.
 *
 * One screening, fifty seats, no login. Whoever you are comes from the URL
 * (`?who=worker-1`), which keeps authentication out of a workshop that is not
 * about authentication.
 *
 * Zero dependencies, plain node:http, all state in memory. It works offline,
 * starts instantly, has no install step that can fail in a room of twenty
 * laptops, and is short enough for attendees to read.
 *
 *   node app/server.mjs        (or: npm run app)
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as state from './state.mjs';
import * as sequencer from './sequencer.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.APP_PORT ?? 3000);

/**
 * The gap between checking a block of seats is free and taking it: thirty
 * milliseconds of plausible real work - a template render, a slow query, an
 * audit log write.
 *
 * This is the *shape* of the bug, and it is what makes the block-booking
 * handler wrong in a way you would recognise in your own codebase. It is not
 * what makes the bug reproduce on demand: that is the rendezvous in
 * sequencer.mjs, which guarantees the two requests are in flight together
 * however far apart the Grid started them.
 */
const RACE_WINDOW_MS = Number(process.env.RACE_WINDOW_MS ?? 30);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendHtml(res, html, status = 200) {
  const body = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    // Never cache: tests mutate state constantly and a cached seat map
    // produces failures that look exactly like the planted ones.
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJson(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {};
  }

  const type = req.headers['content-type'] ?? '';
  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return {};
}

/** Identity comes from `?who=`, with the request body as a fallback. */
function whoFrom(url, body) {
  const who = url.searchParams.get('who') ?? body.who;
  return typeof who === 'string' && who.trim() ? who.trim() : 'anonymous';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function route(req, res, url) {
  const { pathname } = url;
  const method = req.method ?? 'GET';

  // --- test hooks ---------------------------------------------------------
  if (pathname === '/api/_test/health') {
    return sendJson(res, {
      ok: true,
      screenings: state.screenings.size,
      bookings: state.bookings.length,
      workers: sequencer.getConcurrency(),
    });
  }

  if (pathname === '/api/_test/config' && method === 'POST') {
    // Playwright's global setup reports the worker count here, so the app can
    // tell a serial run from a parallel one.
    const { workers } = await readBody(req);
    return sendJson(res, { workers: sequencer.setConcurrency(Number(workers)) });
  }

  if (pathname === '/api/_test/reset' && method === 'POST') {
    state.reset();
    sequencer.reset();
    return sendJson(res, { ok: true });
  }

  // --- screenings ---------------------------------------------------------
  if (pathname === '/api/screenings' && method === 'POST') {
    // A screening of your own. Nobody else knows its id, so nobody else can
    // book its seats.
    const { film, startsAt, priceEur } = await readBody(req);
    const screening = state.createScreening({ film, startsAt, priceEur });
    return sendJson(res, state.screeningSummary(screening), 201);
  }

  const screeningMatch = pathname.match(/^\/api\/screenings\/([^/]+)$/);
  if (screeningMatch && method === 'GET') {
    const screening = state.getScreening(decodeURIComponent(screeningMatch[1]));
    return screening
      ? sendJson(res, state.screeningSummary(screening))
      : sendJson(res, { error: 'unknown screening' }, 404);
  }

  const bookingsMatch = pathname.match(/^\/api\/screenings\/([^/]+)\/bookings$/);
  if (bookingsMatch && method === 'GET') {
    const id = decodeURIComponent(bookingsMatch[1]);
    if (!state.getScreening(id)) {
      return sendJson(res, { error: 'unknown screening' }, 404);
    }
    return sendJson(res, { bookings: state.recentBookings(id) });
  }

  // --- seats --------------------------------------------------------------
  const blockMatch = pathname.match(/^\/api\/screenings\/([^/]+)\/seats$/);
  if (blockMatch && method === 'POST') {
    // Book a party in together. Finds the best available run of adjacent
    // seats, then takes them.
    const screening = state.getScreening(decodeURIComponent(blockMatch[1]));
    if (!screening) {
      return sendJson(res, { error: 'unknown screening' }, 404);
    }

    const body = await readBody(req);
    const who = whoFrom(url, body);
    const count = Number(body.count ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > state.COLUMNS) {
      return sendJson(res, { error: `count must be 1-${state.COLUMNS}` }, 400);
    }

    // Here is the bug, and it is only three lines. We check which seats are
    // free, we do a little work, and then we take them - without looking
    // again. Anything that books one of these seats in between is quietly
    // overwritten.
    const block = state.findBestBlock(screening, count);
    if (!block) {
      return sendJson(res, { error: 'no block of that size is available' }, 409);
    }
    await sequencer.holdForRivalBooking(screening.id, block);
    await sleep(RACE_WINDOW_MS);
    const seats = block.map((seat) => state.assignSeat(screening, seat, who));
    sequencer.announceBlockWrite(screening.id, block);

    return sendJson(res, { who, seats }, 201);
  }

  const seatMatch = pathname.match(/^\/api\/screenings\/([^/]+)\/seats\/(\d+)$/);
  if (seatMatch) {
    const screening = state.getScreening(decodeURIComponent(seatMatch[1]));
    if (!screening) {
      return sendJson(res, { error: 'unknown screening' }, 404);
    }

    const seat = Number(seatMatch[2]);
    if (!state.isValidSeat(seat)) {
      return sendJson(res, { error: `seat must be 1-${state.SEAT_COUNT}` }, 400);
    }

    if (method === 'DELETE') {
      // Give the seat back. Idempotent, so a test can use it to put a known
      // seat into a known state without caring what came before.
      const previous = state.releaseSeat(screening, seat);
      return sendJson(res, { seat, released: previous });
    }

    if (method === 'POST') {
      const body = await readBody(req);
      const who = whoFrom(url, body);

      // Booking one seat is atomic: nothing is awaited between the check and
      // the write, so this path cannot lose an update. Contrast it with the
      // block booking above - that is the whole lesson in two handlers.
      const rendezvous = await sequencer.waitForBlockChoice(screening.id, seat);

      if (!state.seatIsFree(screening, seat)) {
        return sendJson(res, { error: 'seat already booked', seat, who: state.seatHolder(screening, seat) }, 409);
      }

      const booking = state.assignSeat(screening, seat, who);
      await sequencer.waitForRivalWrite(screening.id, seat, rendezvous);

      return sendJson(res, booking, 201);
    }
  }

  // --- pages --------------------------------------------------------------
  if (pathname === '/' && method === 'GET') {
    try {
      return sendHtml(res, await readFile(path.join(ROOT, 'public', 'index.html'), 'utf8'));
    } catch {
      return sendHtml(res, '<!doctype html><title>Odeon Seats</title><p>No seat map yet.', 200);
    }
  }

  return sendJson(res, { error: 'not found' }, 404);
}

// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  route(req, res, url).catch((err) => {
    console.error(`[app] ${req.method} ${url.pathname} failed:`, err);
    if (!res.headersSent) {
      sendJson(res, { error: 'internal error' }, 500);
    } else {
      res.end();
    }
  });
});

server.listen(PORT, () => {
  console.log(`[app] Odeon Seats listening on http://localhost:${PORT}`);
});
