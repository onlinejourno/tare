# Live Browser Analysis — Design Decisions

Decisions captured from grill-with-docs session. Four threads: Signal Detection, GDELT, MCP Real-Browser Analysis, Product Thesis.

---

## Thread 1 — Signal Detection Architecture

**Decision: Three-layer detection, upgrade-only.**

| Layer | Mechanism | Bypasses Cloudflare? |
|---|---|---|
| 1. DOM analysis | Playwright headless browser, post-JS | No |
| 2. Hostname Signal Probes | Plain HTTP GETs to institutional paths | Yes |
| 3. Article Signal Probe | Plain HTTP GET to article URL, 200 KB body | Yes |

Signals only **upgrade** — never downgrade. If DOM finds bylines, Article Signal Probe cannot un-find them.

**Decision: Unified crawler UA — `DemocraticInfrastructureChecker/1.0`**

Single UA for all three layers. Identity consistency; surface for publisher allowlisting. Chrome UA retired from probe functions. See ADR-0001.

**Decision: Article probe skips homepage URLs (path depth < 2)**

Homepage fetch yields zero participation signal and wastes 200 KB. Probe fires only when URL has ≥2 path segments.

**Decision: Soft 404 detection in `_fetchInstitutional()`**

Follows one redirect. Rejects response if: status ≠ 200, body < 500 chars, or body contains soft-404 phrases (`page not found`, `doesn't exist`, `error 404`, etc.).

---

## Thread 2 — GDELT

**Decision: Ignore GDELT entirely.**

GDELT masterfilelist considered as coverage signal source. Rejected — adds dependency complexity for marginal signal improvement. Not implemented, not planned.

---

## Thread 3 — MCP Real-Browser Analysis

### Q1 — Two modes confirmed

| Mode | Mechanism | When used |
|---|---|---|
| Headless | Playwright via web UI | Default |
| Live Browser | Claude-in-Chrome MCP, Claude-orchestrated | When Cloudflare Bot Management blocks Headless |

Both modes produce same structured output: six dimension scores, 0–100 each. Scores comparable across Publications.

### Q2 — Architecture: separate, not integrated (ADR-0002)

**Selected: Model A — MCP analysis is Claude-orchestrated, separate from web UI.**

No IPC bridge between web server and Claude session. Web UI handles Publications Playwright can reach; Claude handles the rest. See `docs/adr/0002-mcp-analysis-is-separate-from-web-ui.md`.

### Q3 — Scoring implementation (ADR-0003)

**Selected: Path B — Claude sends raw signals to `/score` endpoint; Node.js runs all scoring.**

Single implementation of truth. Scoring rubric lives in Node, not in Claude's prompt. Changes to rubric propagate automatically. Signal collection and scoring independently testable. See `docs/adr/0003-live-browser-scoring-via-node-endpoint.md`.

### Q4 — Dimension structure

**Same six dimensions, same weights, both modes.**

| Dimension | Weight |
|---|---|
| Surveillance | 25% |
| Ad-Tech Depth | 20% |
| Page Bloat | 18% |
| Consent & Paywall Integrity | 17% |
| Openness | 12% |
| Performance | 8% |

Live Browser mode uses same composite formula. No reweighting.

### Q5 — JS coverage in Live Browser mode

**Decision: Drop jsCoverage. Flag the gap.**

No Coverage API equivalent in a real browser tab. Page Bloat falls back to transfer weight + request count heuristics. Flag `live_browser_no_coverage` surfaces the limitation. Recorded in CONTEXT.md.

### Q6 — Analyst invocation

**Selected: A — Slash command in Claude Code.**

Analyst runs `/analyse-publication <url>` in Claude Code. Skill file defines the protocol once: which MCP tools to call, what signals to collect, exact `/score` endpoint schema. Reliable, discoverable, no inference drift.

Rejected:
- B (natural language) — risks Claude guessing wrong mode
- C (explicit flag) — informal, no skill file enforces structure

### Q7 — `/score` endpoint payload

**Selected: A — Raw signals only. Node scores everything.**

Claude is pure collector. Payload schema:

```json
{
  "url": "https://thehindu.com/article/...",
  "mode": "live-browser",
  "trackers": [
    { "domain": "doubleclick.net", "category": "ssp", "requestCount": 12 }
  ],
  "requests": [
    { "url": "...", "type": "xhr", "size": null }
  ],
  "domData": {
    "hasRss": true,
    "hasBylines": true,
    "hasEditorialPolicy": true,
    "hasCorrections": false,
    "hasContact": true,
    "hasAbout": true,
    "consentBannerPresent": true,
    "paywallType": "none"
  },
  "requestCount": 187,
  "transferKB": null,
  "ttfb": 312,
  "lcp": null,
  "tbt": null
}
```

Null fields = signal unavailable in Live Browser mode. Node handles nulls per dimension.

### Q8 — Signal collection map

| Dimension | MCP tool | Signal collected |
|---|---|---|
| Surveillance | `read_network_requests` | Request URLs → tracker domain matches, categories |
| Ad-Tech Depth | `read_network_requests` | RTB/SSP/prebid domains, bid request URLs |
| Page Bloat | `read_network_requests` | Request count; response sizes if available (often null) |
| Consent & Paywall | `read_page` + `javascript_tool` | Consent banner DOM presence, paywall type |
| Openness | `javascript_tool` | DOM eval: RSS links, byline elements, editorial/corrections/contact links |
| Performance | `javascript_tool` | `performance.timing` → TTFB only (see Q9) |

### Q9 — Performance in Live Browser mode

**Selected: C — Navigation Timing API via `javascript_tool`. TTFB only. Flag partial measurement.**

Rationale: comparability requires same six dimensions at same weights across both modes.

- A (score 0) rejected — penalises Publication for tool limitation, not actual slowness. Composite artificially lower in Live Browser mode.
- B (reweight five dimensions) rejected — changes composite formula. Scores not comparable across modes.
- C keeps dimension at 8% weight with real TTFB signal.

Collection:
```js
const t = performance.timing;
({ ttfb: t.responseStart - t.navigationStart })
```

LCP requires async PerformanceObserver (not reliably extractable post-load via MCP). TBT unavailable in real browser. Node `/score` endpoint: when `lcp` and `tbt` are null, weights TTFB at 100% of Performance dimension. Flag `live_browser_partial_perf` shown in report.

---

## Thread 4 — Product Thesis

### Q1 — Primary Analyst

**Journalist who runs a website on digital journalism, informing other journalists about the ills and strengths of the business of journalism.**

Not a general-public tool. Not a Publication self-audit tool. Meta-journalism: journalism about journalism.

### Q2 — Output format

**Selected: C — deep dives feed a live index.**

Individual analyses published as articles AND scores accumulate into a live index on the website. Single tool run produces both.

### Q3 — Persistence

**Selected: C1 — local SQLite on Analyst's machine + export pipeline.**

- SQLite stores every run locally. Analyst browses history, compares Publications, sees trends via `localhost:3000/publications`.
- Public website consumes static JSON. Analyst runs `npm run export-index` → generates `index.json` + per-Publication JSON → deploys to website.
- MacBook as source of truth. No live tunnel. No hosted infrastructure.

Rejected: C2 (MacBook exposed via tunnel) — fragile, tool must be always-on.

### Q4 — Narrative production

**Selected: C — structured report card. No AI-generated prose.**

Tool produces a designed report card: scores, flags, raw signals. Analyst embeds or links to it from their article. Analyst writes the narrative in their own voice. No AI authorship of journalism about journalism.

### Q5 — Report card audience

**Selected: A — other journalists (primary).**

Technically literate. Card shows full detail:
- Technical flag labels (fingerprinting, RTB, consent dark patterns)
- Raw signal counts (tracker count, request count, transfer size)
- Dimension breakdown visible by default
- No "show more" hiding of technical depth

### Q6 — Headline differentiator

**Selected: B — Democratic Infrastructure Score.**

> *"Is this publication's technical infrastructure compatible with its democratic function?"*

No existing tool asks this question. EFF measures fingerprinting. Mozilla measures product privacy. CMP scanners check consent banner presence. WebPageTest measures performance. None frame it as democratic infrastructure.

The frame is what's new:
- A tracker on a shoe shop is annoying. On a news publisher it undermines source protection, chills readership, corrupts editorial independence.
- Consent honesty matters because readers of journalism deserve honest gates — not because of GDPR compliance.
- RSS, bylines, corrections are democratic participation infrastructure — not features.

**One-sentence thesis:** The Democratic Infrastructure Score is the only metric that asks whether a news publisher's technical infrastructure is compatible with its democratic function.
