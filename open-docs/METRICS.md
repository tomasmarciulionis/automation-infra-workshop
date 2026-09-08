# Metrics we track

Four metrics. Keep this page open during the workshop and **copy the queries
rather than typing them** — a typo in PromQL costs us a minute we do not have.

Paste them into <http://localhost:9090/graph>, hit **Execute**, and switch to
the **Graph** tab.

---

## All four on one graph

```promql
{__name__=~"selenium_grid_(run_sessions_started|browser_session_count|session_count|max_session)"}
```

That is the whole workshop in one picture: a ceiling (`max_session`) that
nothing crosses, a line pinned against it (`session_count`), and a launch count
(`run_sessions_started`) that keeps climbing past both.

> Do not join them with `or` instead. `selenium_grid_session_count` and
> `selenium_grid_max_session` differ only in their metric name, which `or`
> ignores when it compares series — so it treats them as the same series and
> silently returns just the first. Matching on `__name__` keeps all four.

---

## The four

| Metric | Reads as | Labels |
|---|---|---|
| `selenium_grid_run_sessions_started` | Chromiums started by the current test run | `browser_name`, `run_id` |
| `selenium_grid_browser_session_count` | Sessions open right now, per browser | `browser_name` |
| `selenium_grid_session_count` | Sessions open right now, total | none |
| `selenium_grid_max_session` | Sessions we are allowed to have open at once | none |

All four are gauges, scraped every 2 seconds.

The two middle ones look like duplicates and are not: `browser_session_count`
is the same number broken out per browser, and `session_count` is the single
total the Grid's distributor actually makes decisions against. Ours is a
Chromium-only Grid, so today they agree — on a mixed Grid they would not.

---

## One at a time

### `selenium_grid_run_sessions_started` — chromiums started

```promql
selenium_grid_run_sessions_started
```

How many browsers this run has launched, starting again from 0 at the next run.
The Grid has no concept of a "run" — it sees an unbroken stream of sessions —
so `global-setup.ts` tells the exporter when one begins.

This is the metric that catches a suite launching more browsers than it thinks
it does. `concurrent-customer.spec.ts` calls `chromium.launch()` for its second
customer, so each of its tests takes **two** slots, not one. Run set 3 has two
tests and this reads 4. Nothing in the Playwright report says so.

### `selenium_grid_browser_session_count` — number of sessions, by browser

```promql
selenium_grid_browser_session_count
```

Sessions open right now, labelled `browser_name`. The label reads `chrome`
rather than `chromium`: that is what Playwright asks Selenium for and what the
nodes advertise, whatever the local API is called.

It sits at an explicit `0` between runs rather than disappearing, so an idle
Grid looks idle instead of looking broken.

### `selenium_grid_session_count` — number of sessions

```promql
selenium_grid_session_count
```

Sessions open across the whole Grid. During the parallel run this goes flat at
3 and stays there for the duration. Flat is the tell: it is not a plateau in
demand, it is a ceiling.

### `selenium_grid_max_session` — allowed

```promql
selenium_grid_max_session
```

The ceiling itself: 3 nodes × 1 session each. Constant at 3 for the whole
workshop, which is exactly why it is worth graphing — it turns `session_count`
from a number into a percentage of capacity.

Both come from `config/versions.json` (`grid.nodePorts` and
`grid.maxSessionsPerNode`), and the tests run with 6 workers, so the queue is
guaranteed by arithmetic rather than by how fast your laptop is.

---

## The two derived queries worth having

Utilisation, as a percentage:

```promql
100 * selenium_grid_session_count / selenium_grid_max_session
```

Free slots:

```promql
selenium_grid_max_session - selenium_grid_session_count
```

The first sits at 100% for the whole parallel run and the second sits at 0.
Worth saying out loud: 100% utilisation sounds like success, and it means every
test after the third one is waiting.

---

## If a graph is empty

```bash
curl -s http://localhost:9615/metrics | grep selenium_grid_session_count
```

- No output at all → the exporter is not running. `npm run stop && npm run up`.
- `selenium_grid_up 0` → the exporter is fine but cannot reach the hub.
- Metrics present but Prometheus shows nothing → check
  <http://localhost:9090/targets>; `selenium-grid` should be **UP**.

Prometheus needs a handful of scrapes before a graph looks like anything, so
leave it running rather than starting it just before you want to look at it.
