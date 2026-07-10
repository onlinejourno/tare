'use strict';

// Tests for server/score.js — the Live Browser (/score) scoring path.
//
// CONTEXT.md:52 requires Headless and Live Browser modes to produce the same
// structured score output. The Openness sub-score in particular must use the
// ONE canonical model in openness.js (access 35% / participation 35% /
// aiEditorial 30%, hard-paywall access penalty −60), not a drifted copy.
// These tests pin Live Browser openness to that canonical model.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { scoreFromSignals } = require('./score');

const live = (domData = {}) =>
  scoreFromSignals({ url: 'https://example.com/article', domData });

describe('Live Browser openness matches the canonical openness.js model', () => {
  test('hard paywall uses the canonical access penalty (−60 → access 40)', () => {
    const r = live({ paywallType: 'hard' });
    assert.equal(r.scores.opennessDimensions.access, 40);
  });

  test('metered wall composite uses canonical 35/35/30 weights', () => {
    // access 70, participation 0, aiEditorial 100 → 70*.35 + 100*.30 = 54.5 → 55
    const r = live({ paywallType: 'metered' });
    assert.equal(r.scores.openness, 55);
  });

  test('reader comments count toward participation like Headless (+12)', () => {
    const r = live({ hasComments: true });
    assert.equal(r.scores.opennessDimensions.participation, 12);
  });
});
