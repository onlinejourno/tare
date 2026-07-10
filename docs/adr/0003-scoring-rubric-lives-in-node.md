# Scoring rubric lives in Node, not in Claude's prompt

Live Browser mode has Claude collect raw signals in a real browser and POST them
to `/score`; Headless mode collects them via Playwright. Both could in principle
score client-side, but the rubric (dimension formulas, weights, grade bands) is
implemented once in Node (`server/scoring.js` and the Analysis Result assembly)
and nowhere else. Changes to the rubric propagate to both modes automatically,
and results stay comparable across Publications regardless of mode.

(Backfilled: this decision predates the ADR directory — it was previously
recorded only as a comment in `server/score.js`.)
