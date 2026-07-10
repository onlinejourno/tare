'use strict';

// Tests for server/grades.js — the single owner of the A–F band cutoffs.
// Surveillance/openness/paywall graders all map a score to the same five tiers
// (A≥80, B≥65, C≥45, D≥25, else F); only their labels differ. The numeric
// cutoffs must live in exactly one place.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { gradeTier } = require('./grades');

const cases = [
  [100, 0], [80, 0],   // A band, lower boundary inclusive
  [79.9, 1], [65, 1],  // B
  [64.9, 2], [45, 2],  // C
  [44.9, 3], [25, 3],  // D
  [24.9, 4], [0, 4],   // F
];

for (const [score, tier] of cases) {
  test(`gradeTier(${score}) → ${tier}`, () => {
    assert.equal(gradeTier(score), tier);
  });
}
