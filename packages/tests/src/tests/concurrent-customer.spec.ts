import { chromium } from '@playwright/test';

import { test } from '../fixtures/fixture';
import { SeatMapPage } from '../pages/seat-map-page';

/**
 * Two customers, two browsers. The second customer needs a browser of their
 * own - one page cannot be signed in as two people - so these tests launch
 * one.
 */
test.describe('Concurrent customers', { tag: '@set3' }, () => {
  test('lets two customers book different seats at once', async ({
    baseURL,
    seatsApi,
    seatMapPage,
  }) => {
    const screening = await seatsApi.createDefaultScreening();
    await seatMapPage.open('alice', screening.id);

    const rivalBrowser = await chromium.launch();
    const rivalContext = await rivalBrowser.newContext({ baseURL });
    const rival = new SeatMapPage(await rivalContext.newPage());
    await rival.open('bob', screening.id);

    await seatMapPage.bookSeat(12);
    await rival.bookSeat(13);

    await seatMapPage.expectSeatState(12, 'yours');
    await rival.expectSeatState(13, 'yours');
  });

  test('shows one customer the seat the other just took', async ({
    baseURL,
    seatsApi,
    seatMapPage,
  }) => {
    const screening = await seatsApi.createDefaultScreening();
    await seatMapPage.open('alice', screening.id);

    const rivalBrowser = await chromium.launch();
    const rivalContext = await rivalBrowser.newContext({ baseURL });
    const rival = new SeatMapPage(await rivalContext.newPage());
    await rival.open('bob', screening.id);
    await rival.bookSeat(20);

    await seatMapPage.reload();

    await seatMapPage.expectSeatState(20, 'taken');
    await seatMapPage.expectSeatHeldBy(20, 'bob');
  });
});
