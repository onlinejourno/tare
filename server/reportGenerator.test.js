'use strict';

// Tests for server/reportGenerator.js dimension rendering.
//
// The HTML report renders the six Democratic Infrastructure dimensions. The
// dimension keys/labels are owned by scoring.js (dimensionLabel); the report
// must render every real dimension the scorer produced — including Openness —
// with its real score, not a stale hand-maintained key map that silently
// dropped keys to 0.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { dimensionRowsHtml } = require('./reportGenerator');

const DIMS = {
  surveillance: 80, adTechDepth: 60, consentPaywallIntegrity: 45,
  pageBloat: 70, openness: 55, performance: 90,
};

describe('dimensionRowsHtml renders every canonical dimension', () => {
  test('includes the Consent & Paywall Integrity row with its real score', () => {
    const html = dimensionRowsHtml(DIMS);
    assert.match(html, /Consent & Paywall Integrity/);
    assert.match(html, /45/); // real score, not the old silent 0
  });

  test('includes the Openness row (previously dropped entirely)', () => {
    const html = dimensionRowsHtml(DIMS);
    assert.match(html, /Openness/);
    assert.match(html, /55/);
  });

  test('renders one row per dimension supplied', () => {
    const html = dimensionRowsHtml(DIMS);
    assert.equal((html.match(/<tr>/g) || []).length, Object.keys(DIMS).length);
  });
});
