import { test as base } from '@playwright/test';

import { SeatsApi } from '../api/seats-api';

export interface Apis {
  seatsApi: SeatsApi;
}

export const test = base.extend<Apis>({
  seatsApi: async ({ request }, use) => {
    await use(new SeatsApi(request));
  },
});
