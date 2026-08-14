# Tare

Analyze any web page for unnecessary code, surveillance trackers, unused JavaScript & CSS, and asset bloat. Generates a self-contained HTML report and a machine-readable JSON report.

## What it checks

- **Tracker detection** — matches all network requests against a curated database of 100+ known trackers across 7 categories: analytics, advertising, fingerprinting/session recording, social embeds, A/B testing tools, chat widgets, and tag managers
- **Unused JavaScript** — uses the Chrome Coverage API to measure what percentage of each script is actually executed on page load
- **Unused CSS** — measures how much of each stylesheet is actually applied
- **Third-party requests** — counts, sizes, and categorizes all cross-origin requests
- **Asset bloat** — detects oversized images, missing lazy-loading, and excessive web fonts
- **Scoring** — Page Health Score (performance & bloat) and Privacy Score (tracking & surveillance), each 0–100
- **Recommendations** — actionable fixes with privacy-respecting alternatives (Plausible, Umami, Fathom, GoAccess, OpenReplay, GrowthBook, etc.)

## Quick start

```bash
npm install
npx playwright install chromium
npm start
# Open http://localhost:3000
```

## Self-host with Docker Compose

```bash
docker compose up --build
# Open http://localhost:3000
```

By default the Compose file runs Tare without an external database (`TARE_ALLOW_NO_DB=1`). History is not persisted. To enable persistence, set `DATABASE_URL` to a Postgres connection string in your environment or `.env` file.

## Requirements

- Node.js 18+
- ~300 MB disk for Chromium (downloaded once by Playwright)

## Output

Each analysis generates two downloadable files in `reports/`:

- `web-bloat-report.html` — self-contained, fully offline-readable report
- `web-bloat-report.json` — raw data for further processing

Reports are kept for 10 minutes then cleaned up automatically.

## Privacy

This tool runs entirely on your own machine. No data is sent anywhere except to the URL you choose to analyze. The tracker database is embedded in the source — no external list fetching at runtime.

## Persistence

Analyses are stored in Neon Postgres (`DATABASE_URL`, pooled). Schema auto-creates at boot. `npm test` needs no DB (uses pg-mem).

## Architecture

```
server/
  index.js            Express server, routes, SSE progress streaming
  analyzer.js         Playwright orchestration (coverage, network, DOM)
  scoring.js          Page Health + Privacy scoring algorithms
  recommendations.js  Rule-based recommendation engine
  reportGenerator.js  HTML + JSON report generation
  jobs.js             In-process job state + EventEmitter registry
  data/
    trackers.js       Embedded tracker database (100+ entries)
public/
  index.html          Web UI
  style.css
  app.js              SSE client, result rendering
reports/              Generated report files (gitignored)
```

## Open source — newsroom tech, by a journalist

This is one of [OnlineJourno](https://onlinejourno.com)'s **fully open-source** tools (MIT). OnlineJourno's *products* are fair-source; this one is a deliberate gift to the commons — no strings.

**Why a journalist built this:** most newsroom technology is built by engineers *at* news organisations, *for* news organisations. This isn't that. I'm a journalist — 25+ years in digital newsrooms — and I built this because readers' data leaks to ad-networks while a page crawls to load, and no one in editorial can see it. A page's *privacy cost* should be visible to the people who publish it, not buried in ad-ops. It's open because surveillance-free publishing shouldn't be a paid feature.

**If you care about privacy, the open web, or journalism — this is an on-ramp.** Contributions especially welcome on the tracker database — see [CONTRIBUTING.md](CONTRIBUTING.md); start with an issue labelled `good first issue`.

## Licence

MIT — fully open source, use it freely. See [LICENSE.md](LICENSE.md).

**Maturity:** live. Solid: SSRF guard, 180-test suite incl. golden band/detector tests.

## Part of OnlineJourno

Tare is a fully open MIT tool from [OnlineJourno](https://onlinejourno.com). It is also one of the capabilities that feed into **[OnlineJourno Newsroom](https://onlinejourno.com/newsroom)**.

Grading note: the reader-respect scale (A>=80, B>=65, C>=45, D>=25; Reader-Respecting through Egregious) is deliberately distinct from the OnlineJourno suite's A-F editorial bands.
