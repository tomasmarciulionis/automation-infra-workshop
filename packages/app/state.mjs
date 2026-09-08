/**
 * In-memory application state.
 *
 * Deliberately a plain module-level object: no database, no persistence, no
 * dependencies. Restarting the server is a full reset, and
 * `POST /api/_test/reset` is a reset without a restart.
 */

/**
 * The screening every test reaches for, because it is the one in the fixtures.
 * Planted failure 1 is two tests both booking seats on this screening.
 */
export const SHARED_SCREENING_ID = 's1';

export const ROWS = 5;
export const COLUMNS = 10;
export const SEAT_COUNT = ROWS * COLUMNS;

/**
 * Seat 26 is the middle of the middle row: the best seat in the house, and the
 * one a "best available" block booking reaches for first. Planted failure 1 is
 * a single booking and a block booking both landing on it.
 */
export const CONTENDED_SEAT = 26;

/**
 * Reserved for the order-dependency exercise. Back row, far from anything the
 * block booker would ever choose, so that failure can never be confused with
 * failure 1.
 */
export const HANDOVER_SEAT = 44;

/**
 * Fixed instant, so the localised showtime is the same on every machine.
 * 23:30 UTC on 15 March is 01:30 on the *16th* anywhere east of Greenwich,
 * which is what makes planted failure 2 visible in the date as well as the
 * time.
 */
export const SHOWTIME = '2026-03-15T23:30:00Z';

export const TICKET_PRICE_EUR = 12.5;

const SEED_SCREENING = {
  film: 'The Midnight Grid',
  startsAt: SHOWTIME,
  priceEur: TICKET_PRICE_EUR,
};

/** The centre of the auditorium, as a fractional seat number. */
const AUDITORIUM_CENTRE = (SEAT_COUNT + 1) / 2;

/** @type {Map<string, {id: string, film: string, startsAt: string, priceEur: number, seats: Array<string|null>}>} */
export const screenings = new Map();

/** @type {Array<{id: string, screeningId: string, seat: number, who: string, bookedAt: string}>} */
export let bookings = [];

let screeningSequence = 1;
let bookingSequence = 0;

function makeScreening(id, { film, startsAt, priceEur }) {
  return {
    id,
    film,
    startsAt,
    priceEur,
    // A seat holds the name of whoever booked it, or null when it is free.
    seats: new Array(SEAT_COUNT).fill(null),
  };
}

export function reset() {
  screenings.clear();
  screenings.set(SHARED_SCREENING_ID, makeScreening(SHARED_SCREENING_ID, SEED_SCREENING));
  bookings = [];
  screeningSequence = 1;
  bookingSequence = 0;
}

/**
 * A screening of its own, for a test that wants to own its data.
 *
 * This is the fix for planted failure 1: a test that books seats on a
 * screening nobody else knows about cannot collide with anyone.
 */
export function createScreening({ film, startsAt, priceEur } = {}) {
  screeningSequence += 1;
  const id = `s${screeningSequence}`;
  const screening = makeScreening(id, {
    film: film ?? SEED_SCREENING.film,
    startsAt: startsAt ?? SEED_SCREENING.startsAt,
    priceEur: priceEur ?? SEED_SCREENING.priceEur,
  });
  screenings.set(id, screening);
  return screening;
}

export function getScreening(id) {
  return screenings.get(id);
}

export function isValidSeat(seat) {
  return Number.isInteger(seat) && seat >= 1 && seat <= SEAT_COUNT;
}

export function seatHolder(screening, seat) {
  return screening.seats[seat - 1];
}

export function seatIsFree(screening, seat) {
  return screening.seats[seat - 1] === null;
}

export function assignSeat(screening, seat, who) {
  screening.seats[seat - 1] = who;
  bookingSequence += 1;
  const booking = {
    id: `BKG-${String(bookingSequence).padStart(4, '0')}`,
    screeningId: screening.id,
    seat,
    who,
    bookedAt: new Date().toISOString(),
  };
  bookings.push(booking);
  return booking;
}

/** Returns whoever held the seat, or null if it was already free. */
export function releaseSeat(screening, seat) {
  const previous = screening.seats[seat - 1];
  screening.seats[seat - 1] = null;
  return previous;
}

export function freeSeatCount(screening) {
  return screening.seats.reduce((count, holder) => (holder === null ? count + 1 : count), 0);
}

/** Newest first. Feeds the "recent bookings" panel. */
export function recentBookings(screeningId, limit = 10) {
  return bookings
    .filter((booking) => booking.screeningId === screeningId)
    .slice(-limit)
    .reverse();
}

const blockCentre = (block) => (block[0] + block[block.length - 1]) / 2;

/**
 * Every run of `count` adjacent seats within a single row, best first.
 *
 * "Best" is distance from the centre of the auditorium, which in one number
 * prefers the middle row and then the middle of it. Ties go to the lower seat
 * number so that a party of three lands in the same seats on every machine.
 */
function candidateBlocks(count) {
  const blocks = [];
  for (let row = 0; row < ROWS; row += 1) {
    const firstSeat = row * COLUMNS + 1;
    for (let start = firstSeat; start + count - 1 < firstSeat + COLUMNS; start += 1) {
      blocks.push(Array.from({ length: count }, (_, offset) => start + offset));
    }
  }
  return blocks.sort(
    (a, b) =>
      Math.abs(blockCentre(a) - AUDITORIUM_CENTRE) - Math.abs(blockCentre(b) - AUDITORIUM_CENTRE) ||
      a[0] - b[0],
  );
}

/**
 * The best available run of `count` adjacent seats, or undefined if the party
 * cannot be seated together. With an empty auditorium and a party of three
 * this returns seats 24, 25 and 26 - which is why CONTENDED_SEAT is 26.
 */
export function findBestBlock(screening, count) {
  return candidateBlocks(count).find((block) => block.every((seat) => seatIsFree(screening, seat)));
}

/** The payload behind GET /api/screenings/:id. */
export function screeningSummary(screening) {
  return {
    id: screening.id,
    film: screening.film,
    startsAt: screening.startsAt,
    priceEur: screening.priceEur,
    rows: ROWS,
    columns: COLUMNS,
    seatCount: SEAT_COUNT,
    freeCount: freeSeatCount(screening),
    seats: screening.seats.map((who, index) => ({ seat: index + 1, who })),
  };
}

reset();
