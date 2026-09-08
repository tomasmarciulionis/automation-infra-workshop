import { test as base } from '@playwright/test';

import { SeatMapPage } from '../pages/seat-map-page';

export interface Pages {
  seatMapPage: SeatMapPage;
}

export const test = base.extend<Pages>({
  seatMapPage: async ({ page }, use) => {
    await use(new SeatMapPage(page));
  },
});
