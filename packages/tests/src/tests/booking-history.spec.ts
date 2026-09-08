import { test } from '../fixtures/fixture';

test.describe('Booking history', { tag: '@set2' }, () => {
  test('books a seat in the back row', async ({ seatMapPage }) => {
    await seatMapPage.open('dana', 's1');

    await seatMapPage.bookSeat(44);

    await seatMapPage.expectSeatState(44, 'yours');
  });

  test('shows recent bookings', async ({ seatMapPage }) => {
    await seatMapPage.open('erin', 's1');

    await seatMapPage.expectBookingListed(44, 'dana');
  });
});
