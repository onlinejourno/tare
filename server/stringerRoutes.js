'use strict';

// Stringer capability surface for Tare.
//
// Read-only and cheap on purpose. Tare analyses a page by driving a headless
// browser, which is far too expensive to sit behind something the hub polls on
// a 60-second hint. This returns what has already been stored; running a fresh
// analysis stays an explicit action a person takes.

/**
 * A summary of one stored analysis.
 *
 * Deliberately not the stored report. A full result carries every network
 * request and coverage entry — megabytes, on every poll, to render a score.
 */
function buildLatestPayload(row) {
  if (!row) return { latest: null };

  const num = (v) => (typeof v === 'number' ? v : null);

  return {
    run_id: row.runId ?? row.run_id ?? null,
    url: row.url ?? null,
    analysed_at: row.analysedAt ?? row.analysed_at ?? null,
    scores: {
      overall: num(row.scoreOverall),
      surveillance: num(row.scoreSurveillance),
      adtech: num(row.scoreAdtech),
      bloat: num(row.scoreBloat),
      performance: num(row.scorePerformance),
      openness: num(row.scoreOpenness),
    },
  };
}

module.exports = { buildLatestPayload };
