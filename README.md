# Your tests are lying to you

A 60-minute hands-on workshop on distributed test execution.

You will build a Selenium Grid on your own laptop, run a Playwright suite
across it in parallel, and watch three tests fail for reasons that have nothing
to do with the features they claim to test. Then you will diagnose each one
from evidence, and leave with a checklist for auditing your own suite.

**The stack:** Playwright → Selenium Grid 4 hub → three Chromium nodes, with
Prometheus watching the Grid.

> The three "nodes" are three separate processes on one machine, simulating
> multiple machines. Registration, distribution and queuing behave exactly as
> they do in production, so every concept transfers — but this is not a real
> cluster, and all three nodes share your laptop's CPU and RAM.

---

## Attending? Start here

Do this **before** the workshop, on a good internet connection.
It takes about ten minutes and downloads roughly 400 MB.

**macOS**
```bash
bash scripts/preflight-macos.sh
```

**Linux**
```bash
bash scripts/preflight-linux.sh
```

**Windows**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\preflight-windows.ps1
```

Then confirm:

```bash
npm run doctor
```

All green means you are ready. Anything else, read
**[open-docs/PREREQUISITES.md](open-docs/PREREQUISITES.md)** — it has manual install
commands for every OS, corporate-laptop workarounds, and what to do when a
check fails.

---

## Quick reference

```bash
npm run up            # start app, Grid (3 nodes), exporter and Prometheus
npm run doctor        # verify the environment
npm run stop          # stop everything and reap orphaned processes

npm run test:local        # local Chromium, 1 worker  -> 8 pass
npm run test:grid         # Grid, 6 workers, 3 slots  -> the interesting one
npm run test:setN         # one problem set at a time, N is 1 to 4
```

| What | Where |
|---|---|
| Grid console | <http://localhost:4444/ui> |
| Prometheus | <http://localhost:9090> |
| Demo app | <http://localhost:3000> |
| Raw metrics | <http://localhost:9615/metrics> |

The four metrics we watch, with queries to copy straight into Prometheus, are
in **[open-docs/METRICS.md](open-docs/METRICS.md)**. Have that page open during
the session.

How the pieces fit together — the single entry point, the queue manager and the
three nodes — is drawn in
**[open-docs/GRID-ARCHITECTURE.md](open-docs/GRID-ARCHITECTURE.md)**.

**If anything gets weird:** `npm run stop && npm run doctor`. That is the reset
button, and it clears the orphaned `chromedriver` processes that otherwise make
the next run fail confusingly.

---

## Repository layout

An npm-workspaces monorepo. Every command above runs from the root; the root
scripts delegate into the packages, so you never need to `cd` anywhere.

```
packages/app/      @workshop/app    the demo application (zero dependencies)
packages/tests/    @workshop/tests  the Playwright suite
scripts/  tools/                    Grid, Prometheus and setup tooling
config/  docs/
```

The two packages do not depend on each other. Their only contract is the HTTP
API on port 3000, which is the same contract they have during the workshop,
when the tests run in a browser on a different machine from the app.


## Versions

Everything is pinned in [`config/versions.json`](config/versions.json), which
both `npm run setup` and `npm run doctor` read. Change a version or a port
there and nowhere else.

| | Version |
|---|---|
| Selenium Grid | 4.48.0 |
| Playwright | 1.62.1 |
| Prometheus | 3.14.0 |
| Java | 17 recommended, 11 minimum |
| Node.js | 22 recommended, 20 minimum |

---

## A caveat worth knowing

Playwright's Selenium Grid support is **experimental and Chromium-only**.
Playwright does not speak WebDriver; it asks the Grid for a Chrome session and
attaches over the Chrome DevTools Protocol websocket that Grid 4 exposes.
Selenium has deprecated CDP in favour of WebDriver BiDi and plans to remove it,
and Playwright has said it is gradually retiring the experiment.

**This combination has a shelf life.** It is used here because it makes
distributed-execution concepts visible through an API most attendees already
know. It is a teaching rig, not an architecture recommendation. See
[SETUP.md](docs/SETUP.md#the-playwright--grid-caveat).

---
