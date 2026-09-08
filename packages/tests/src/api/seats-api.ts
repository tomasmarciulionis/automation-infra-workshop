import type { APIRequestContext } from '@playwright/test';

export interface Seat {
  seat: number;
  who: string | null;
}

export interface Screening {
  id: string;
  film: string;
  startsAt: string;
  priceEur: number;
  rows: number;
  columns: number;
  seatCount: number;
  freeCount: number;
  seats: Seat[];
}

export interface Booking {
  id: string;
  screeningId: string;
  seat: number;
  who: string;
  bookedAt: string;
}

/** What the app needs in order to put a screening on. */
export interface NewScreening {
  film: string;
  startsAt: string;
  priceEur: number;
}

/**
 * Spread this to vary one field: `{ ...DEFAULT_SCREENING, priceEur: 20 }`.
 * The showtime is a fixed instant so that anything asserting on it is stable.
 */
export const DEFAULT_SCREENING: NewScreening = {
  film: 'The Midnight Grid',
  startsAt: '2026-03-15T23:30:00Z',
  priceEur: 12.5,
};

export class SeatsApi {
  constructor(private readonly request: APIRequestContext) {}

  /** A screening of this test's own. Nobody else knows its id. */
  async createScreening(screening: NewScreening): Promise<Screening> {
    const response = await this.request.post('/api/screenings', { data: screening });
    return response.json();
  }

  /** The same screening every time, for tests that do not care about the film. */
  async createDefaultScreening(): Promise<Screening> {
    return this.createScreening(DEFAULT_SCREENING);
  }

  /** Read a screening, seats and all. */
  async getScreening(screeningId: string): Promise<Screening> {
    const response = await this.request.get(`/api/screenings/${screeningId}`);
    return response.json();
  }

  /** Empty every screening in the app. */
  async reset(): Promise<void> {
    await this.request.post('/api/_test/reset');
  }

  /** Book one seat as somebody. Arrange, not the thing under test. */
  async bookSeat(screeningId: string, seat: number, who: string): Promise<Booking> {
    const response = await this.request.post(`/api/screenings/${screeningId}/seats/${seat}`, {
      params: { who },
    });
    return response.json();
  }

  /** Give a seat back. Idempotent, so it is safe on a seat nobody holds. */
  async releaseSeat(screeningId: string, seat: number): Promise<void> {
    await this.request.delete(`/api/screenings/${screeningId}/seats/${seat}`);
  }
}
