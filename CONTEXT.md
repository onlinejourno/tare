# Web Bloat Checker

A news publisher surveillance auditor — it measures the technical infrastructure of news websites against reader rights: tracking apparatus, consent honesty, ad-tech depth, page bloat, and performance.

## Language

**Publication**:
A news website being audited (e.g. thehindu.com, theguardian.com).
_Avoid_: site, website, page, target

**Analysis**:
A single audit run against one Publication URL — produces Scores, Flags, and a Report.
_Avoid_: scan, check, test, job (job is an internal implementation term)

**Reader**:
The human who visits the Publication and whose rights are being measured.
_Avoid_: user, visitor, end-user

**Tracker**:
A third-party script or request that collects Reader data without their meaningful consent.
_Avoid_: script, third-party, tag

**Surveillance Score**:
A 0–100 dimension measuring the depth and severity of the tracking apparatus deployed against Readers. Higher = less surveillance.
_Avoid_: privacy score (too vague)

**Democratic Infrastructure Score**:
The composite 0–100 score representing whether a Publication's technical infrastructure is compatible with its democratic function as a news publisher.
_Avoid_: overall score, total score

**Openness Score**:
A 0–100 dimension measuring whether a Publication is structurally open to readers: free access vs. paywalls, participation infrastructure (RSS, bylines, corrections), and degree of AI editorial control.
_Avoid_: accessibility score, transparency score

**Consent & Paywall Integrity Score**:
A merged 0–100 dimension measuring honesty at both the consent gate (cookie/tracking consent UI) and the access gate (paywall). Both measure the same axis: does the publisher treat readers honestly at the gates it puts in front of them?
_Avoid_: paywall score, consent score (each is only half the picture)

**Signal Probe**:
A server-side plain HTTP request that extracts participation and editorial signals from a Publication independently of the headless browser — used when bot protection (e.g. Cloudflare Bot Management) blocks DOM analysis.
_Avoid_: fallback, scrape, HTTP check


**Analyst**:
The journalist or researcher who runs an Analysis using this tool.
_Avoid_: user, operator, researcher (too generic)

**Analysis Result**:
The complete scored output of one Analysis — the analysis data plus Scores (Democratic Infrastructure Score, dimension grades, flags, the Openness and Paywall panels) and Recommendations. Assembled in exactly one place (`server/analysisResult.js`) regardless of mode; the mode-parity promise ("both modes produce the same structured score output") is a property of this seam, and `scores.mode` / `scores.missingSignals` record which mode produced it and what it couldn't measure.
_Avoid_: result object, scored result, response shape

## Relationships

- An **Analysis** targets one **Publication**
- An **Analysis** runs in one of two modes: **Headless** (Playwright, via web UI) or **Live Browser** (Claude-in-Chrome MCP, invoked directly by the Analyst when bot protection blocks Headless mode)
- Both modes produce the same structured score output — six dimensions, 0–100 each — so results are comparable across Publications
- Live Browser mode does not produce JS coverage data (no Coverage API equivalent in a real browser tab); Page Bloat falls back to transfer weight + request count heuristics and flags the gap
- An **Analysis** produces one **Democratic Infrastructure Score** (composite of six dimension scores)
- A **Tracker** belongs to exactly one category (analytics, fingerprinting, ssp, social_pixel, etc.)
- A **Publication** may deploy zero or more **Trackers**

## Scoring architecture (resolved)

Six dimensions, weights sum to 100%:

| Dimension | Weight | Measures |
|---|---|---|
| Surveillance | 25% | Depth and severity of tracking apparatus |
| Ad-Tech Depth | 20% | RTB/programmatic participation |
| Page Bloat | 18% | Transfer weight, unused code, request count |
| Consent & Paywall Integrity | 17% | Honesty at consent UI (70%) + paywall gate (30%); falls back to 100% consent when no paywall detected |
| Openness | 12% | Access, participation, AI editorial control |
| Performance | 8% | LCP, TBT, TTFB |

## Design decisions (resolved)

- Paywall-type penalty (hard/metered/registration) applies in BOTH Openness.access AND Consent & Paywall Integrity — intentional double-count because they measure different axes: existence of gate vs. quality of gate implementation.
- Openness and Paywall detail panels remain as standalone drill-downs in the UI AND their scores feed into the Democratic Infrastructure Score composite. The composite is the headline number; the panels provide the detail.
- Flags added from Openness: `algo_recs` (high), `predictive_paywall` (high), `headline_testing` (medium), `hard_paywall` (medium), `no_rss` (low).
- Flags added from Paywall Audit: `paywall_profiling` (high), `paywall_bloat` (medium).
- Positive flags added from Openness: `open_feed` ✅, `no_algo_editorial` ✅.

## Signal detection architecture (resolved)

Participation and editorial signals are extracted from three independent layers, each acting as a fallback for the one above:

1. **DOM analysis** — Playwright headless browser reads the live page after JS execution. Most accurate, but blocked by Cloudflare Bot Management on some Publications.
2. **Hostname Signal Probes** — plain HTTP GETs to known institutional paths (`/rssfeeds/`, `/aboutus/`, `/values/`, etc.). Runs in parallel with browser navigation; bypasses Cloudflare JS challenges.
3. **Article Signal Probe** — plain HTTP GET to the specific article URL. Extracts bylines, corrections links, and contact links from static HTML. Requires 200 KB body read.

All three layers only **upgrade** signals — never downgrade. If the DOM finds bylines, the Article Signal Probe cannot un-find them. The probe layer — the SSRF-guarded fetch, the three probes, their scheduling (Article Signal Probe only on path depth ≥ 2), and this upgrade-only merge — lives in one module, `server/signalProbes.js`, used by both Analysis modes.

**Bot Protection** (Cloudflare Bot Management):
When a Publication serves a JS challenge page ("Just a moment…") to the headless browser, DOM-based scores are unreliable. The tool detects this and shows a warning. Signal Probes are unaffected and produce accurate participation signals regardless.

## Flagged ambiguities

- "web bloat" — used in the repo name and README but the primary domain is surveillance auditing of news publishers; bloat is one measured dimension, not the core concept.
- "Consent Integrity" — old name for what is now "Consent & Paywall Integrity"; the two axes (consent UI dark patterns + paywall transparency/hygiene) share the same moral axis and are merged into one dimension.
