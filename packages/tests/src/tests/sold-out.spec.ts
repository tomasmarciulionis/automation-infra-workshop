import { test } from '../fixtures/fixture';

/**
 * Counting the seats in the main auditorium only means something if it starts
 * empty, so this file empties it before each test. The app offers a hook that
 * does exactly that.
 */
test.describe('Sold out', { tag: '@set4' }, () => {
  test.beforeEach(async ({ seatsApi }) => {
    await seatsApi.reset();
  });

  test.afterEach(async ({ seatsApi }) => {
    await seatsApi.reset();
  });

  test('starts with the whole house free', async ({ seatsApi, seatMapPage }) => {
    const screening = await seatsApi.getScreening('s1');

    await seatMapPage.open('coach', screening.id);

    await seatMapPage.expectFreeSeats(screening.seatCount);
  });

  test('reports no free seats once the whole house is booked', async ({
    seatsApi,
    seatMapPage,
  }) => {
    const screening = await seatsApi.createDefaultScreening();
    await seatMapPage.open('coach', screening.id);

    await seatMapPage.bookWholeHouse();

    await seatMapPage.expectFreeSeats(0);
  });

  test('shows a full house as taken to the next customer', async ({ seatsApi, seatMapPage }) => {
    const screening = await seatsApi.createDefaultScreening();
    await seatMapPage.open('coach', screening.id);
    await seatMapPage.bookWholeHouse();

    await seatMapPage.open('latecomer', screening.id);

    await seatMapPage.expectSeatState(1, 'taken');
    await seatMapPage.expectSeatHeldBy(1, 'coach');
  });
});
