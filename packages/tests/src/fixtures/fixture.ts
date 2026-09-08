import { mergeTests } from '@playwright/test';

import { test as apis } from './api-fixture';
import { test as gridSession } from './grid-session-fixture';
import { test as pages } from './pages-fixture';

/**
 * The canonical `test` for this repo. Specs import from here, never from
 * `@playwright/test` directly, so that page and API fixtures can be added
 * without touching a single spec file.
 */
export const test = mergeTests(gridSession, pages, apis);

export { expect } from '@playwright/test';
