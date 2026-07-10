'use strict';

// HTML report smoke test — pins the six-dimension breakdown (the report was
// stuck on a stale five-dimension model with the dead `consentIntegrity` key:
// it rendered that row as 0 and omitted Openness entirely) and that grade
// bands/labels come from scoring.scoreGrade rather than a drifted local copy.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generateHtmlReport } = require('./reportGenerator');
const { DIMENSION_META, scoreGrade } = require('./scoring');

function fixtureResult() {
  return {
    meta: { url: 'https://example.com/story', analyzedAt: '2026-07-10T00:00:00.000Z', durationMs: 1234 },
    scores: {
      overall: 65,
      overallGrade: scoreGrade(65),
      dimensions: {
        surveillance: 62, adTechDepth: 64, consentPaywallIntegrity: 62,
        pageBloat: 73, openness: 55, performance: 80,
      },
      dimensionGrades: {},
      flags: [],
      openness: 55,
      opennessDimensions: {},
    },
    trackers: [],
    coverage: { js: [], css: [] },
    requests: { total: 90, thirdPartyCount: 36, byType: {} },
    assets: { totalTransferBytes: 2.5 * 1024 * 1024, images: [], fonts: [] },
    consentAudit: { consentBannerDetected: true, trackersFireBeforeConsent: false, preConsentThirdPartyCount: 0 },
    performanceMetrics: { lcp: 2600, tbt: 250, ttfb: 500 },
    googleAttribution: { requestCount: 0, requestPercent: 0, bytes: 0, bytesPercent: 0, products: [], isDoubleBind: false },
    rtbCascade: { count: 0, headerBiddingDetected: false, uniqueParticipants: 0, participantNames: [] },
    recommendations: [],
  };
}

describe('generateHtmlReport six-dimension breakdown', () => {
  test('renders all six dimension labels with their scores', () => {
    const html = generateHtmlReport(fixtureResult());
    for (const [key, meta] of Object.entries(DIMENSION_META)) {
      assert.ok(html.includes(meta.label), `missing dimension label: ${meta.label}`);
      assert.ok(html.includes(meta.description), `missing description for: ${key}`);
    }
    assert.ok(html.includes('55/100'), 'Openness score value must render');
  });

  test('six-dimension title, no stale five-dimension copy', () => {
    const html = generateHtmlReport(fixtureResult());
    assert.ok(html.includes('Six-Dimension Score Breakdown'));
    assert.ok(!html.includes('Five-Dimension'));
    assert.ok(!html.includes('Consent Integrity<'), 'stale 5-dim label must not render');
  });

  test('overall grade label comes from scoring.scoreGrade', () => {
    const html = generateHtmlReport(fixtureResult());
    assert.ok(html.includes(scoreGrade(65).label)); // "Moderate"
  });
});
