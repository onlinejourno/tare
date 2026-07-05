'use strict';

// Golden/characterization tests for server/scoring.js.
//
// These pin the CURRENT behaviour: the grade bands, each dimension's
// arithmetic, and the composite weighted blend. If a contributor PR changes
// any expected number here, that is an intentional semantic change and must
// show up as a visible diff in review — not slip through silently.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  surveillanceScore,
  adTechDepthScore,
  consentPaywallIntegrityScore,
  opennessDimensionScore,
  pageBloatScore,
  performanceImpactScore,
  democraticInfrastructureScore,
  scoreGrade,
  dimensionLabel,
} = require('./scoring');

// Minimal "clean site" analysis: no trackers, no RTB, tiny page, honest banner.
function cleanAnalysis(overrides = {}) {
  return {
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

const tracker = (category, name = category) => ({ category, name });

const MB = 1024 * 1024;

// ── Grade bands (the contract: A≥80, B≥65, C≥45, D≥25, else F) ───────────────

describe('scoreGrade bands', () => {
  const cases = [
    [100,  'A', 'Reader-Respecting', 'green'],
    [80,   'A', 'Reader-Respecting', 'green'],   // lower A boundary inclusive
    [79.9, 'B', 'Moderate',          'lime'],
    [65,   'B', 'Moderate',          'lime'],    // lower B boundary inclusive
    [64.9, 'C', 'Concerning',        'amber'],
    [45,   'C', 'Concerning',        'amber'],   // lower C boundary inclusive
    [44.9, 'D', 'Exploitative',      'orange'],
    [25,   'D', 'Exploitative',      'orange'],  // lower D boundary inclusive
    [24.9, 'F', 'Egregious',         'red'],
    [0,    'F', 'Egregious',         'red'],
  ];
  for (const [score, grade, label, colorClass] of cases) {
    test(`scoreGrade(${score}) → ${grade} "${label}"`, () => {
      assert.deepEqual(scoreGrade(score), { grade, label, colorClass });
    });
  }
});

// ── Dimension 1: Surveillance ─────────────────────────────────────────────────

describe('surveillanceScore', () => {
  test('clean analysis scores 100', () => {
    assert.equal(surveillanceScore(cleanAnalysis()), 100);
  });

  test('golden mixed-tracker fixture scores 13', () => {
    // fingerprinting 15 + identity_resolution 15 + data_broker min(30, 2*12)=24
    // + social_pixel 10 + ssp 8 + analytics 7 + tag_manager 8 = 87 → 13
    const analysis = cleanAnalysis({
      trackers: [
        tracker('fingerprinting', 'Hotjar'),
        tracker('identity_resolution', 'LiveRamp'),
        tracker('data_broker', 'Lotame'),
        tracker('data_broker', 'Oracle BlueKai'),
        tracker('social_pixel', 'Facebook Pixel'),
        tracker('ssp', 'PubMatic'),
        tracker('analytics', 'Google Analytics 4'),
        tracker('tag_manager', 'Google Tag Manager'),
      ],
    });
    assert.equal(surveillanceScore(analysis), 13);
  });

  test('per-category deductions are capped (4 social pixels cap at 35)', () => {
    const analysis = cleanAnalysis({
      trackers: [1, 2, 3, 4].map(i => tracker('social_pixel', `Pixel ${i}`)),
    });
    assert.equal(surveillanceScore(analysis), 65); // 4*10=40 capped at 35
  });

  test('header bidding deducts a flat 15', () => {
    const analysis = cleanAnalysis({
      rtbCascade: { count: 3, headerBiddingDetected: true },
    });
    assert.equal(surveillanceScore(analysis), 85);
  });

  test('score floors at 0', () => {
    const analysis = cleanAnalysis({
      trackers: [
        'fingerprinting', 'fingerprinting', 'fingerprinting',
        'identity_resolution', 'identity_resolution', 'identity_resolution',
        'data_broker', 'data_broker', 'data_broker',
        'social_pixel', 'social_pixel', 'social_pixel', 'social_pixel',
        'ssp', 'ssp', 'ssp', 'ssp',
        'analytics', 'analytics', 'analytics',
        'tag_manager', 'tag_manager',
      ].map(c => tracker(c)),
      rtbCascade: { count: 5, headerBiddingDetected: true },
    });
    assert.equal(surveillanceScore(analysis), 0);
  });
});

// ── Dimension 2: Ad-Tech Depth ────────────────────────────────────────────────

describe('adTechDepthScore', () => {
  test('clean analysis scores 100', () => {
    assert.equal(adTechDepthScore(cleanAnalysis()), 100);
  });

  test('golden RTB + header bidding + GAM fixture scores 24', () => {
    // RTB 30 + header bidding 20 + 2 SSPs 12 + 1 advertising 4 + GAM 10 = 76 → 24
    const analysis = cleanAnalysis({
      rtbCascade: { count: 4, headerBiddingDetected: true },
      trackers: [
        tracker('ssp', 'PubMatic'),
        tracker('ssp', 'Magnite'),
        tracker('advertising', 'Google Ad Manager / DoubleClick'),
      ],
    });
    assert.equal(adTechDepthScore(analysis), 24);
  });

  test('SSP deduction caps at 25', () => {
    const analysis = cleanAnalysis({
      trackers: [1, 2, 3, 4, 5, 6].map(i => tracker('ssp', `SSP ${i}`)),
    });
    assert.equal(adTechDepthScore(analysis), 75); // 6*6=36 capped at 25
  });

  test('non-Google advertising alone deducts 4 per tracker (no GAM penalty)', () => {
    const analysis = cleanAnalysis({
      trackers: [tracker('advertising', 'Criteo')],
    });
    assert.equal(adTechDepthScore(analysis), 96);
  });
});

// ── Dimension 3: Consent & Paywall Integrity ─────────────────────────────────

describe('consentPaywallIntegrityScore', () => {
  test('clean analysis scores 100', () => {
    assert.equal(consentPaywallIntegrityScore(cleanAnalysis()), 100);
  });

  test('missing consentAudit scores 100 even with trackers (characterization)', () => {
    const analysis = cleanAnalysis({ consentAudit: null, trackers: [tracker('ssp')] });
    assert.equal(consentPaywallIntegrityScore(analysis), 100);
  });

  test('no consent banner despite trackers deducts 50', () => {
    const analysis = cleanAnalysis({
      consentAudit: { consentBannerDetected: false, trackersFireBeforeConsent: false, preConsentThirdPartyCount: 0 },
      trackers: [tracker('analytics', 'GA4')],
    });
    assert.equal(consentPaywallIntegrityScore(analysis), 50);
  });

  test('pre-consent firing (35) + 4 pre-consent third parties (6) → 59', () => {
    const analysis = cleanAnalysis({
      consentAudit: { consentBannerDetected: true, trackersFireBeforeConsent: true, preConsentThirdPartyCount: 4 },
    });
    assert.equal(consentPaywallIntegrityScore(analysis), 59);
  });

  test('pre-consent third-party deduction caps at 15', () => {
    const analysis = cleanAnalysis({
      consentAudit: { consentBannerDetected: true, trackersFireBeforeConsent: false, preConsentThirdPartyCount: 20 },
    });
    assert.equal(consentPaywallIntegrityScore(analysis), 85);
  });

  test('pre-ticked boxes (22) + generic pattern count (min(18, 2*7)=14) → 64', () => {
    const analysis = cleanAnalysis({
      darkPatterns: { bannerFound: true, pretickedBoxes: 1, hasNoRejectOption: false, patternCount: 2 },
    });
    assert.equal(consentPaywallIntegrityScore(analysis), 64);
  });

  test('no-reject-option deducts 25 and suppresses the generic pattern deduction', () => {
    const analysis = cleanAnalysis({
      darkPatterns: { bannerFound: true, pretickedBoxes: 0, hasNoRejectOption: true, patternCount: 3 },
    });
    assert.equal(consentPaywallIntegrityScore(analysis), 75);
  });

  test('hard ad-block wall deducts 28, soft wall 16', () => {
    const hard = cleanAnalysis({ adBlockerWall: { wallDetected: true, wallType: 'hard' } });
    const soft = cleanAnalysis({ adBlockerWall: { wallDetected: true, wallType: 'message' } });
    assert.equal(consentPaywallIntegrityScore(hard), 72);
    assert.equal(consentPaywallIntegrityScore(soft), 84);
  });

  test('paywall audit blends 70% consent + 30% paywall', () => {
    const analysis = cleanAnalysis({ paywallAudit: { score: 40 } });
    assert.equal(consentPaywallIntegrityScore(analysis), 82); // 100*0.7 + 40*0.3

    const messy = cleanAnalysis({
      consentAudit: { consentBannerDetected: false, trackersFireBeforeConsent: false, preConsentThirdPartyCount: 0 },
      trackers: [tracker('ssp')],
      paywallAudit: { score: 40 },
    });
    assert.equal(consentPaywallIntegrityScore(messy), 47); // 50*0.7 + 40*0.3
  });
});

// ── Dimension 4: Page Bloat ───────────────────────────────────────────────────

describe('pageBloatScore', () => {
  test('clean analysis scores 100', () => {
    assert.equal(pageBloatScore(cleanAnalysis()), 100);
  });

  test('golden bloated-page fixture scores 25', () => {
    // 6MB (30) + 70% unused JS (18) + 60% unused CSS (4) + 60% third-party (10)
    // + 100 requests (5) + 2 oversized images (4) + 5 fonts (4) = 75 → 25
    const analysis = cleanAnalysis({
      assets: {
        totalTransferBytes: 6 * MB,
        images: [{ isOversized: true }, { isOversized: true }, { isOversized: false }],
        fonts: [1, 2, 3, 4, 5],
      },
      coverage: { jsTotalBytes: 1000, jsUnusedBytes: 700, cssTotalBytes: 1000, cssUnusedBytes: 600 },
      requests: { total: 100, thirdPartyCount: 60 },
    });
    assert.equal(pageBloatScore(analysis), 25);
  });

  test('page weight tiers: 9MB deducts 40', () => {
    const analysis = cleanAnalysis({
      assets: { totalTransferBytes: 9 * MB, images: [], fonts: [] },
    });
    assert.equal(pageBloatScore(analysis), 60);
  });

  test('oversized image deduction caps at 8', () => {
    const analysis = cleanAnalysis({
      assets: { totalTransferBytes: 0, images: Array(10).fill({ isOversized: true }), fonts: [] },
    });
    assert.equal(pageBloatScore(analysis), 92);
  });
});

// ── Dimension 5: Performance Impact ──────────────────────────────────────────

describe('performanceImpactScore', () => {
  test('all-null metrics score 100 (no data, no penalty)', () => {
    assert.equal(performanceImpactScore(cleanAnalysis()), 100);
  });

  test('missing performanceMetrics scores 100', () => {
    assert.equal(performanceImpactScore(cleanAnalysis({ performanceMetrics: null })), 100);
  });

  test('golden mid-range fixture: LCP 3000 (12) + TBT 500 (15) + TTFB 700 (5) → 68', () => {
    const analysis = cleanAnalysis({ performanceMetrics: { lcp: 3000, tbt: 500, ttfb: 700 } });
    assert.equal(performanceImpactScore(analysis), 68);
  });

  test('worst-tier fixture: LCP 7000 (35) + TBT 900 (25) + TTFB 2500 (20) → 20', () => {
    const analysis = cleanAnalysis({ performanceMetrics: { lcp: 7000, tbt: 900, ttfb: 2500 } });
    assert.equal(performanceImpactScore(analysis), 20);
  });
});

// ── Dimension 6: Openness passthrough ────────────────────────────────────────

describe('opennessDimensionScore', () => {
  test('passes through openness.overall', () => {
    assert.equal(opennessDimensionScore(cleanAnalysis({ openness: { overall: 73 } })), 73);
  });

  test('falls back to neutral 50 when openness data is unavailable', () => {
    assert.equal(opennessDimensionScore(cleanAnalysis()), 50);
    assert.equal(opennessDimensionScore(cleanAnalysis({ openness: {} })), 50);
  });
});

// ── Composite: Democratic Infrastructure Score (weights pin) ─────────────────
// Weights: surveillance 25%, adTech 20%, bloat 18%, consent+paywall 17%,
// openness 12%, performance 8%.

describe('democraticInfrastructureScore', () => {
  test('clean analysis without openness data scores 94 (openness fallback 50)', () => {
    // 100*.25 + 100*.20 + 100*.18 + 100*.17 + 50*.12 + 100*.08 = 94
    const result = democraticInfrastructureScore(cleanAnalysis());
    assert.equal(result.overall, 94);
    assert.deepEqual(result.dimensions, {
      surveillance: 100,
      adTechDepth: 100,
      consentPaywallIntegrity: 100,
      pageBloat: 100,
      openness: 50,
      performance: 100,
    });
  });

  test('openness weight is 12%: perfect site with openness 0 scores 88', () => {
    const result = democraticInfrastructureScore(cleanAnalysis({ openness: { overall: 0 } }));
    assert.equal(result.overall, 88);
    const perfect = democraticInfrastructureScore(cleanAnalysis({ openness: { overall: 100 } }));
    assert.equal(perfect.overall, 100);
  });

  test('golden composite fixture: dimensions 62/64/62/73/80 + openness 55 → 65 (grade B)', () => {
    // surveillance: 2 fingerprinting (30) + 1 ssp (8) = 62
    // adTech:       RTB (30) + 1 ssp (6)              = 64
    // consent:      pre-consent fires (35) + 2 pre-consent parties (3) = 62
    // bloat:        2.5MB (12) + 40% unused JS (5) + 40% 3rd-party (5) + 90 reqs (5) = 73
    // performance:  LCP 2600 (12) + TBT 250 (8) + TTFB 500 (0) = 80
    // overall: 62*.25 + 64*.20 + 73*.18 + 62*.17 + 55*.12 + 80*.08 = 64.98 → 65
    const analysis = cleanAnalysis({
      trackers: [
        tracker('fingerprinting', 'Hotjar'),
        tracker('fingerprinting', 'FullStory'),
        tracker('ssp', 'PubMatic'),
      ],
      rtbCascade: { count: 5, headerBiddingDetected: false },
      consentAudit: { consentBannerDetected: true, trackersFireBeforeConsent: true, preConsentThirdPartyCount: 2 },
      assets: { totalTransferBytes: 2.5 * MB, images: [], fonts: [] },
      coverage: { jsTotalBytes: 1000, jsUnusedBytes: 400, cssTotalBytes: 0, cssUnusedBytes: 0 },
      requests: { total: 90, thirdPartyCount: 36 },
      performanceMetrics: { lcp: 2600, tbt: 250, ttfb: 500 },
      openness: { overall: 55 },
    });

    const result = democraticInfrastructureScore(analysis);
    assert.deepEqual(result.dimensions, {
      surveillance: 62,
      adTechDepth: 64,
      consentPaywallIntegrity: 62,
      pageBloat: 73,
      openness: 55,
      performance: 80,
    });
    assert.equal(result.overall, 65);
    assert.equal(scoreGrade(result.overall).grade, 'B');
  });
});

// ── Dimension labels ──────────────────────────────────────────────────────────

describe('dimensionLabel', () => {
  test('pins the label for every dimension key (incl. legacy)', () => {
    const keys = [
      'surveillance', 'adTechDepth', 'consentPaywallIntegrity',
      'pageBloat', 'openness', 'performance', 'consentIntegrity',
    ];
    assert.deepEqual(keys.map(dimensionLabel), [
      'Surveillance', 'Ad-Tech Depth', 'Consent & Paywall Integrity',
      'Page Bloat', 'Openness', 'Performance', 'Consent Integrity',
    ]);
    assert.equal(dimensionLabel('unknown_key'), 'unknown_key');
  });
});
