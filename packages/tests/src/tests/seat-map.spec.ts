import { test } from '../fixtures/fixture';

/**
 * The seat map, checked the boring way. Every test here creates the screening
 * it works on, so none of them cares how many workers are running.
 */
test.describe('Seat map', () => {
  test('shows every seat in the auditorium', async ({ seatsApi, seatMapPage }) => {
    const screening = await seatsApi.createDefaultScreening();

    await seatMapPage.open('alice', screening.id);

    await seatMapPage.expectSeatsShown(screening.seatCount);
    await seatMapPage.expectFreeSeats(screening.seatCount);
  });

  test('books a free seat', async ({ seatsApi, seatMapPage }) => {
    const screening = await seatsApi.createDefaultScreening();
    await seatMapPage.open('alice', screening.id);

    await seatMapPage.bookSeat(12);

    await seatMapPage.expectSeatState(12, 'yours');
    await seatMapPage.expectFreeSeats(screening.seatCount - 1);
  });

  test('will not book a seat somebody else is sitting in', async ({ seatsApi, seatMapPage }) => {
    const screening = await seatsApi.createDefaultScreening();
    await seatsApi.bookSeat(screening.id, 12, 'bob');
    await seatMapPage.open('alice', screening.id);

    await seatMapPage.bookSeat(12);

    await seatMapPage.expectStatus('Seat 12 was already taken by bob.');
    await seatMapPage.expectSeatHeldBy(12, 'bob');
  });

  test('shows a seat as free again once it is released', async ({ seatsApi, seatMapPage }) => {
    const screening = await seatsApi.createDefaultScreening();
    await seatsApi.bookSeat(screening.id, 12, 'alice');
    await seatMapPage.open('alice', screening.id);
    await seatMapPage.expectSeatState(12, 'yours');

    await seatsApi.releaseSeat(screening.id, 12);
    await seatMapPage.reload();

    await seatMapPage.expectSeatState(12, 'free');
  });
});
