# Recommendation triggers are independent of scoring tiers

`recommendations.js` triggers advice at its own cutoffs (e.g. unused JS > 55%,
page weight > 3/6 MB, fonts > 4), which deliberately differ from the deduction
tiers in `scoring.js` (unused JS > 50/65/80, weight > 1/2/3/5/8 MB, fonts > 3/6).
Scoring tiers are a grading curve — they start penalising early to differentiate
Publications; recommendation triggers are advice cutoffs — they fire only where
acting on the advice is clearly worth an Analyst's attention. Unifying them
would either spam borderline recommendations or flatten the grading curve.
Do not "fix" this divergence; grade bands and dimension metadata, by contrast,
ARE single-sourced from `scoring.js` (`scoreGrade`, `DIMENSION_META`, `PERF_TIERS`).
