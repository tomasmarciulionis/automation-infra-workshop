import { test } from '../fixtures/fixture';

test.describe('Group booking', { tag: '@set1' }, () => {
  test('seats a party of three together', async ({ seatMapPage }) => {
    await seatMapPage.open('bob', 's1');

    await seatMapPage.bookParty();

    await seatMapPage.expectSeatsYours(3);
  });
});
