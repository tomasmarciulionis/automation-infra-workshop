import { test } from '../fixtures/fixture';

test.describe('Seat booking', { tag: '@set1' }, () => {
  test('keeps the seat it booked', async ({ seatsApi, seatMapPage }) => {
    // The best seat in the house, free again for us.
    await seatsApi.releaseSeat('s1', 26);

    await seatMapPage.open('alice', 's1');
    await seatMapPage.bookSeat(26);

    await seatMapPage.expectStatus('Seat 26 is yours.');
    await seatMapPage.expectSeatState(26, 'yours');
  });
});
