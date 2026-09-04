'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { buildLatestPayload } = require('./stringerRoutes');

test('the payload is a summary, not the whole report', () => {
  // A full analysis carries every network request and coverage entry. The hub
  // polls this; shipping the lot on every poll would move megabytes to render
  // a score.
  const row = {
    runId: 'r1',
    url: 'https://example.test/story',
    analysedAt: '2026-09-04T00:00:00Z',
    scoreOverall: 71,
    scoreSurveillance: 60,
    scorePerformance: 80,
    result: { requests: new Array(500).fill({ big: 'x'.repeat(500) }) },
    full_result_json: { enormous: true },
  };

  const out = buildLatestPayload(row);

  assert.equal(out.run_id, 'r1');
  assert.equal(out.url, 'https://example.test/story');
  assert.equal(out.scores.overall, 71);
  assert.equal(out.scores.surveillance, 60);
  assert.equal(out.scores.performance, 80);
  assert.equal(out.result, undefined, 'the full report must not be included');
  assert.equal(out.full_result_json, undefined);
});

test('no analysis yet is an empty answer, not an error', () => {
  // A newly installed Tare has run nothing. That is a real state and the hub
  // should render "nothing yet", not an outage.
  assert.deepEqual(buildLatestPayload(null), { latest: null });
});

test('a missing score is null rather than invented', () => {
  const out = buildLatestPayload({ runId: 'r2', url: 'https://e.test', analysedAt: 't' });
  assert.equal(out.scores.overall, null);
  assert.equal(out.scores.surveillance, null);
});
