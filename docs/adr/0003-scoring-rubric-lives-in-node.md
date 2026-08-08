# ADR 0003: Scoring rubric lives in Node, not in Claude's prompt

## Context

Live Browser Analysis has Claude collect raw signals from a real browser via
Chrome MCP (network requests, DOM state, JS globals). Headless Analysis collects
the same signals via Playwright. Both paths could in principle apply the scoring
rubric themselves, but that would mean two implementations of the same rubric.

## Decision

The rubric (dimension formulas, weights, grade bands) is implemented once in
Node (`server/scoring.js` and the Analysis Result assembly) and nowhere else.

In Live Browser mode, Claude serialises the raw signals as JSON and POSTs them
to the local `/score` endpoint, which runs the same scoring functions as
Headless mode.

## Consequences

- Scores remain comparable across publications regardless of analysis mode.
- The rubric can change in one place; there is no prompt-to-code drift.
- Signal collection and scoring are independently testable.

(Backfilled: this decision predates the ADR directory — it was previously
recorded only as a comment in `server/score.js`.)
