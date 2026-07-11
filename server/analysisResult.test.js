'use strict';

// Analysis Result assembly — the seam where both Analysis modes (Headless and
// Live Browser) converge. These tests pin the assembled shape and the mode
// parity guarantee: identical analysis in → identical scores out, whichever
// mode produced it (only the mode metadata may differ).

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { assembleAnalysisResult } = require('./analysisResult');

function cleanAnalysis(overrides = {}) {
  return {
    url: 'https://example.com/news/story',
    trackers: [],
    rtbCascade: { count: 0, headerBiddingDetected: false },
    consentAudit: { consentBannerDetected: true, trackersFireBeforeConsent: false, preConsentThirdPartyCount: 0 },
    darkPatterns: { bannerFound: false },
    adBlockerWall: { wallDetected: false },
    paywallAudit: null,
    coverage: { jsTotalBytes: 0, jsUnusedBytes: 0, cssTotalBytes: 0, cssUnusedBytes: 0 },
    assets: { totalTransferBytes: 0, images: [], fonts: [] },
    requests: { total: 0, thirdPartyCount: 0 },
    performanceMetrics: { lcp: null, tbt: null, ttfb: null },
    ...overrides,
  };
}

describe('assembleAnalysisResult shape', () => {
  test('carries the analysis through and adds scores + recommendations', () => {
    const analysis = cleanAnalysis();
    const r = assembleAnalysisResult(analysis, { mode: 'headless' });
    assert.equal(r.url, analysis.url);
    assert.equal(typeof r.scores.overall, 'number');
    assert.ok(r.scores.overallGrade.grade);
    assert.ok(Array.isArray(r.scores.flags));
    assert.ok(Array.isArray(r.recommendations));
    // one grade per dimension
    assert.deepEqual(
      Object.keys(r.scores.dimensionGrades).sort(),
      Object.keys(r.scores.dimensions).sort()
    );
  });

  test('openness fallback: missing openness panel defaults to 50', () => {
    const r = assembleAnalysisResult(cleanAnalysis(), { mode: 'headless' });
    assert.equal(r.scores.openness, 50);
    assert.ok(r.scores.opennessGrade.grade);
    assert.deepEqual(r.scores.opennessDimensions, {});
  });

  test('paywall panel present iff paywallAudit present', () => {
    const without = assembleAnalysisResult(cleanAnalysis(), { mode: 'headless' });
    assert.equal('paywallScore' in without.scores, false);

    const pw = { score: 40, dimensions: { transparency: 40 } };
    const withPw = assembleAnalysisResult(cleanAnalysis({ paywallAudit: pw }), { mode: 'headless' });
    assert.equal(withPw.scores.paywallScore, 40);
    assert.ok(withPw.scores.paywallGrade);
    assert.deepEqual(withPw.scores.paywallDimensions, { transparency: 40 });
  });

  test('legacy pageHealth/privacy aliases are gone (verified unread anywhere)', () => {
    const r = assembleAnalysisResult(cleanAnalysis(), { mode: 'headless' });
    assert.equal('pageHealth' in r.scores, false);
    assert.equal('privacy' in r.scores, false);
  });
});

describe('mode metadata (uniform across modes)', () => {
  test('headless: mode set, missingSignals defaults to []', () => {
    const r = assembleAnalysisResult(cleanAnalysis(), { mode: 'headless' });
    assert.equal(r.scores.mode, 'headless');
    assert.deepEqual(r.scores.missingSignals, []);
  });

  test('live-browser: missingSignals passed through', () => {
    const r = assembleAnalysisResult(cleanAnalysis(), {
      mode: 'live-browser',
      missingSignals: ['jsCoverage', 'lcp'],
    });
    assert.equal(r.scores.mode, 'live-browser');
    assert.deepEqual(r.scores.missingSignals, ['jsCoverage', 'lcp']);
  });
});

describe('mode parity', () => {
  test('same analysis scores identically in both modes (only meta differs)', () => {
    const analysis = cleanAnalysis({
      trackers: [{ category: 'fingerprinting', name: 'Hotjar' }],
      openness: { overall: 55, dimensions: { access: 60, participation: 50, aiEditorial: 55 } },
    });
    const headless = assembleAnalysisResult(analysis, { mode: 'headless' });
    const live     = assembleAnalysisResult(analysis, { mode: 'live-browser', missingSignals: ['jsCoverage'] });

    const strip = (s) => { const { mode, missingSignals, ...rest } = s; return rest; };
    assert.deepEqual(strip(headless.scores), strip(live.scores));
    assert.deepEqual(headless.recommendations, live.recommendations);
  });
});
