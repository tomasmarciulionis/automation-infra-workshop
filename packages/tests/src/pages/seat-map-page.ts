import { expect, type Locator, type Page } from '@playwright/test';

export type SeatState = 'free' | 'yours' | 'taken';

export class SeatMapPage {
  private readonly seatMap: Locator;
  private readonly seats: Locator;
  private readonly yourSeats: Locator;
  private readonly freeCount: Locator;
  private readonly status: Locator;
  private readonly partyButton: Locator;
  private readonly recentBookings: Locator;

  constructor(private readonly page: Page) {
    this.seatMap = page.getByTestId('seat-map');
    this.seats = this.seatMap.getByRole('button');
    this.yourSeats = this.seatMap.locator('[data-state="yours"]');
    this.freeCount = page.getByTestId('free-count');
    this.status = page.getByTestId('status');
    this.partyButton = page.getByTestId('book-party');
    this.recentBookings = page.getByTestId('recent-bookings');
  }

  async open(who: string, screeningId: string): Promise<void> {
    const query = new URLSearchParams({ who, screening: screeningId });
    await this.page.goto(`/?${query.toString()}`);
    await this.expectDrawn();
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await this.expectDrawn();
  }

  /**
   * Both booking methods wait for their own response before returning. The
   * page only redraws once the request comes back, and over the Grid that can
   * take a while, so asserting straight after the click would be a race.
   */
  async bookSeat(seat: number): Promise<void> {
    const booked = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/seats/${seat}`),
    );
    await this.seatButton(seat).click();
    await booked;
  }

  /** Fill the auditorium the way a customer would, one seat at a time. */
  async bookWholeHouse(): Promise<void> {
    const seatCount = await this.seats.count();
    for (let seat = 1; seat <= seatCount; seat += 1) {
      await this.bookSeat(seat);
    }
  }

  async bookParty(): Promise<void> {
    const seated = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/seats'),
    );
    await this.partyButton.click();
    await seated;
  }

  async expectSeatsShown(count: number): Promise<void> {
    await expect(this.seats).toHaveCount(count);
  }

  async expectSeatsYours(count: number): Promise<void> {
    await expect(this.yourSeats).toHaveCount(count);
  }

  async expectFreeSeats(count: number): Promise<void> {
    await expect(this.freeCount).toHaveText(String(count));
  }

  async expectStatus(message: string): Promise<void> {
    await expect(this.status).toHaveText(message);
  }

  /**
   * Seat state is an attribute rather than only a colour, so the assertion
   * does not depend on the stylesheet.
   */
  async expectSeatState(seat: number, state: SeatState): Promise<void> {
    await expect(this.seatButton(seat)).toHaveAttribute('data-state', state);
  }

  async expectSeatHeldBy(seat: number, who: string): Promise<void> {
    await expect(this.seatButton(seat)).toHaveAttribute('data-who', who);
  }

  async expectBookingListed(seat: number, who: string): Promise<void> {
    await expect(this.recentBookings.getByText(`Seat ${seat} — ${who}`)).toBeVisible();
  }

  /** The map is drawn client-side, so wait for it rather than for the load. */
  private async expectDrawn(): Promise<void> {
    await expect(this.seats.first()).toBeVisible();
  }

  private seatButton(seat: number): Locator {
    return this.page.getByTestId(`seat-${seat}`);
  }
}
