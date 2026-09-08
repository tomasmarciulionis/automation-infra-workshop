# Odeon Seats

The application the workshop's tests run against. One cinema screening, fifty
seats, and no login.

It is about 250 lines of plain Node with **zero dependencies** — no framework,
no build step, no database. All state lives in memory, so restarting the server
is a full reset. You are meant to be able to read the whole thing.

---

## Run it

```bash
npm run app                 # from the repo root
```

Then open <http://localhost:3000/?who=me>.

Set `APP_PORT` to use a different port.

---

## Who you are

There is no sign-in. **Identity comes from the URL:**

```
http://localhost:3000/?who=alice
```

Whatever you put in `who` is the name attached to any seat you book. Open two
browser windows with two different names and you have two customers.

You can also choose which screening you are looking at:

```
http://localhost:3000/?who=alice&screening=s1
```

`s1` is the default, and it is the only screening that exists when the app
starts. You can create more — see [the API](#the-api) below.

---

## The screen

| Part | What it shows |
|---|---|
| Header | The film, its start time, and the ticket price |
| Free-seat count | How many of the fifty seats are still free |
| Seat grid | Five rows of ten. Seat 1 is front-left, seat 50 is back-right |
| Status line | What happened when you last clicked something |
| Recent bookings | The last ten bookings on this screening, newest first |

Seats have three states, and three colours:

| Colour | Meaning |
|---|---|
| Light grey | Free — click to book it |
| Green | Yours — booked by the `who` in your URL |
| Dark | Taken by somebody else. Hover to see who |

**Book a party of three** takes the best available run of three adjacent seats,
the way a booking site seats a group together.

---

## The API

Everything the page does, it does over these endpoints. They are just as usable
from `curl`.

### Read a screening

```bash
curl localhost:3000/api/screenings/s1
```

```json
{
  "id": "s1",
  "film": "The Midnight Grid",
  "startsAt": "2026-03-15T23:30:00Z",
  "priceEur": 12.5,
  "rows": 5,
  "columns": 10,
  "seatCount": 50,
  "freeCount": 49,
  "seats": [
    { "seat": 1, "who": null },
    { "seat": 2, "who": null },
    "… all fifty, in order …",
    { "seat": 26, "who": "alice" }
  ]
}
```

A seat holds the name of whoever booked it, or `null` when it is free.

### Book one seat

```bash
curl -X POST "localhost:3000/api/screenings/s1/seats/26?who=alice"
```

`201` with the booking, or `409` if the seat is already taken — and the `409`
tells you who has it.

### Book a party together

```bash
curl -X POST "localhost:3000/api/screenings/s1/seats?who=bob" \
  -H 'Content-Type: application/json' -d '{"count":3}'
```

`201` with the seats it chose. It picks the most central run of adjacent free
seats, and routes around seats that are already taken.

### Release a seat

```bash
curl -X DELETE localhost:3000/api/screenings/s1/seats/26
```

Always succeeds, and tells you who was holding it. Releasing a free seat is
harmless, which makes this a handy way for a test to put a seat into a known
state.

### Recent bookings

```bash
curl localhost:3000/api/screenings/s1/bookings
```

### Create your own screening

```bash
curl -X POST localhost:3000/api/screenings
```

`201` with a fresh fifty-seat screening and a new id. Nobody else knows that
id, so nobody else will be booking its seats. Pass `film`, `startsAt` or
`priceEur` in the body to override the defaults.

### Test hooks

| Endpoint | Purpose |
|---|---|
| `GET /api/_test/health` | Is the app up, and how much is in it |
| `POST /api/_test/reset` | Wipe everything back to one empty screening |
| `POST /api/_test/config` | How the test runner tells the app how many workers it is using |

`reset` is called once at the start of every test run, not between individual
tests.

---

## Hooks for tests

Every element a test needs has a `data-testid`, so tests never depend on CSS
classes or on the wording of a label.

| `data-testid` | Element |
|---|---|
| `screening-title` | The film name |
| `showtime` | The start time |
| `ticket-price` | The price of one ticket |
| `free-count` | Seats still free |
| `seat-count` | Seats in total |
| `who` | The name you are booking as |
| `seat-map` | The grid itself |
| `seat-1` … `seat-50` | Each seat button |
| `status` | The status line |
| `book-party` | The party-booking button |
| `recent-bookings` | The bookings list |
| `latest-booking` | The newest row in it |

Some elements carry extra attributes with the underlying values:

```html
<button data-testid="seat-26" data-state="taken" data-who="bob">26</button>
<time data-testid="showtime" data-iso="2026-03-15T23:30:00Z">15.3.2026, 23:30:00</time>
<span data-testid="ticket-price" data-amount="12.50" data-currency="EUR">12,50 €</span>
```

`data-state` is `free`, `yours` or `taken`.

---

## The files

| File | What is in it |
|---|---|
| `server.mjs` | Every route, and the responses above |
| `state.mjs` | The screenings, the seats, and the bookings |
| `public/index.html` | The entire UI — markup, CSS and JavaScript in one file |
| `sequencer.mjs` | Explained during the workshop |
| `scenarios.test.mjs` | `npm run test:app`, with the app running |
