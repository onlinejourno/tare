'use strict';

const test   = require('node:test');
const assert = require('node:assert');

const { parseArgs, evaluateBudget, summarise, EXIT } = require('./cli');

// A result shaped like assembleAnalysisResult's, trimmed to what the CLI reads.
function fakeResult(over = {}) {
  return {
    meta: { url: 'https://example.com/', analyzedAt: '2026-09-22T00:00:00Z', durationMs: 900,
            toolVersion: '2.2.0', accessBlocked: null },
    trackers: [{ name: 'Google Analytics', category: 'analytics', severity: 'medium' }],
    requests: { total: 30, thirdPartyCount: 4, thirdPartyPercent: 13 },
    assets:   { totalTransferBytes: 180_000, totalTransferFormatted: '175.8 KB' },
    coverage: { jsTotalBytes: 100_000, jsUnusedBytes: 60_000, jsUnusedPercent: 60,
                cssTotalBytes: 20_000, cssUnusedBytes: 4_000, cssUnusedPercent: 20 },
    scores:   { overall: 72, overallGrade: 'C', openness: 80 },
    ...over,
  };
}

test('parseArgs: a url is required', () => {
  assert.throws(() => parseArgs([]), /url/i);
});

test('parseArgs: budgets and flags', () => {
  const a = parseArgs(['https://x.example/', '--max-transfer-bytes', '250000',
                       '--max-trackers', '0', '--json', '--allow-private']);
  assert.equal(a.url, 'https://x.example/');
  assert.equal(a.maxTransferBytes, 250_000);
  assert.equal(a.maxTrackers, 0);
  assert.equal(a.json, true);
  assert.equal(a.allowPrivate, true);
});

test('parseArgs: KB and MB suffixes, because a budget is written in KB', () => {
  assert.equal(parseArgs(['https://x.example/', '--max-transfer-bytes', '250kb']).maxTransferBytes,
               256_000);
  assert.equal(parseArgs(['https://x.example/', '--max-transfer-bytes', '1mb']).maxTransferBytes,
               1_048_576);
});

test('parseArgs: a budget that is not a number is refused, not silently ignored', () => {
  assert.throws(() => parseArgs(['https://x.example/', '--max-transfer-bytes', 'big']), /number/i);
});

test('evaluateBudget: no budget given means nothing to fail', () => {
  const v = evaluateBudget(fakeResult(), {});
  assert.deepEqual(v, []);
});

test('evaluateBudget: transfer over budget is a named failure with both numbers', () => {
  const v = evaluateBudget(fakeResult(), { maxTransferBytes: 150_000 });
  assert.equal(v.length, 1);
  assert.equal(v[0].check, 'transfer_bytes');
  assert.equal(v[0].actual, 180_000);
  assert.equal(v[0].budget, 150_000);
});

test('evaluateBudget: exactly on budget passes — a budget is a ceiling, not a cliff', () => {
  assert.deepEqual(evaluateBudget(fakeResult(), { maxTransferBytes: 180_000 }), []);
});

test('evaluateBudget: trackers, third parties and unused JS each have a budget', () => {
  const v = evaluateBudget(fakeResult(), {
    maxTrackers: 0, maxThirdParty: 2, maxUnusedJsPercent: 50,
  });
  assert.deepEqual(v.map(x => x.check).sort(),
                   ['third_party_requests', 'trackers', 'unused_js_percent']);
});

test('summarise: the machine-readable shape a CI job reads', () => {
  const s = summarise(fakeResult(), [{ check: 'transfer_bytes', actual: 180_000, budget: 150_000 }]);
  assert.equal(s.url, 'https://example.com/');
  assert.equal(s.transferBytes, 180_000);
  assert.equal(s.trackers, 1);
  assert.equal(s.thirdPartyRequests, 4);
  assert.equal(s.unusedJsPercent, 60);
  assert.equal(s.scores.overall, 72);
  assert.equal(s.passed, false);
  assert.equal(s.violations.length, 1);
});

test('summarise: a page that was blocked says so rather than reporting a clean zero', () => {
  const blocked = fakeResult({
    meta: { url: 'https://x/', analyzedAt: 'now', durationMs: 1, toolVersion: '2.2.0',
            accessBlocked: { blocked: true, by: 'cloudflare' } },
  });
  assert.equal(summarise(blocked, []).accessBlocked.by, 'cloudflare');
});

test('exit codes are distinct: a budget failure is not a crash', () => {
  assert.equal(EXIT.ok, 0);
  assert.equal(EXIT.budget, 1);
  assert.equal(EXIT.error, 2);
  assert.notEqual(EXIT.budget, EXIT.error);
});
