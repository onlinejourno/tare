'use strict';

// Golden/characterization tests for server/openness.js.
//
// analyzeOpenness(page, trackers, probeData) only uses the page for one
// page.evaluate() (and an article-fallback tab we avoid by keeping
// firstArticleUrl null). All scoring — access, participation, aiEditorial,
// wall-type classification and the composite blend — runs Node-side, so the
// scorer is driven here with synthetic DOM fixtures and tracker lists.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { analyzeOpenness, opennessGrade } = require('./openness');

// ── Fixture helpers ───────────────────────────────────────────────────────────

// All-negative DOM baseline (as returned by the in-page evaluate).
function makeDom(overrides = {}) {
  return {
    hasRss: false, hasCreativeCommons: false, hasBylines: false, hasComments: false,
    hasContact: false, hasCorrections: false, hasAbout: false, hasEditorialPolicy: false,
    htmlLang: 'en', altRatio: 0, hasMain: false, hasSkipLink: false,
    hasSearch: false, hasArchive: false,
    hardPaywall: [], meteredPaywall: [], regWall: [], paywallEls: [],
    aiDisclosures: [], hasAlgoWidgets: false,
    bodyLength: 5000,
    firstArticleUrl: null, // keeps the article-fallback tab from opening
    ...overrides,
  };
}

function score(dom, trackers = [], probeData = {}) {
  const fakePage = { evaluate: async () => dom };
  return analyzeOpenness(fakePage, trackers, probeData);
}

const tracker = (name, category = 'analytics') => ({ name, category });
const signalIds = (signals) => signals.map(s => s.id);

// ── Baseline ──────────────────────────────────────────────────────────────────

test('all-negative DOM baseline: access 100, participation 0, aiEditorial 100 → overall 65', async () => {
  const result = await score(makeDom());
  assert.deepEqual(result.dimensions, { access: 100, participation: 0, aiEditorial: 100 });
  // 100*0.35 + 0*0.35 + 100*0.30 = 65
  assert.equal(result.overall, 65);
  assert.equal(result.signals.wallType, 'none');
  assert.deepEqual(signalIds(result.signals.participationSignals), [
    'no_rss', 'no_bylines', 'no_corrections', 'no_editorial', 'poor_alt_text',
  ]);
  assert.deepEqual(signalIds(result.signals.aiSignals), ['no_ai_detected']);
});

// ── Dimension 1: Access / wall-type classification ───────────────────────────

describe('access dimension and wall-type classification', () => {
  test('hard paywall phrase → wallType hard, access 40', async () => {
    const result = await score(makeDom({ hardPaywall: ['subscribe to read'] }));
    assert.equal(result.signals.wallType, 'hard');
    assert.deepEqual(result.signals.wallSignals, ['subscribe to read']);
    assert.equal(result.dimensions.access, 40);
  });

  test('paywall DOM element alone also classifies as hard', async () => {
    const result = await score(makeDom({ paywallEls: ['[class*="paywall"]'] }));
    assert.equal(result.signals.wallType, 'hard');
    assert.equal(result.dimensions.access, 40);
  });

  test('metered phrase → wallType metered, access 70', async () => {
    const result = await score(makeDom({ meteredPaywall: ['articles remaining'] }));
    assert.equal(result.signals.wallType, 'metered');
    assert.equal(result.dimensions.access, 70);
  });

  test('registration phrase → wallType registration, access 82', async () => {
    const result = await score(makeDom({ regWall: ['register to read'] }));
    assert.equal(result.signals.wallType, 'registration');
    assert.equal(result.dimensions.access, 82);
  });

  test('hard takes precedence over metered and registration', async () => {
    const result = await score(makeDom({
      hardPaywall: ['subscribers only'],
      meteredPaywall: ['articles remaining'],
      regWall: ['register to read'],
    }));
    assert.equal(result.signals.wallType, 'hard');
    assert.equal(result.dimensions.access, 40);
  });

  test('negative: no wall phrases or elements → access 100', async () => {
    const result = await score(makeDom());
    assert.equal(result.dimensions.access, 100);
  });
});

// ── Dimension 2: Participation & Transparency ────────────────────────────────
// Point values: rss 18, bylines 16, comments 12, corrections 14, contact 10,
// editorial 12, cc_license 10, alt_text 5, landmarks 3 — total exactly 100.

describe('participation dimension', () => {
  const cases = [
    [{ hasRss: true },             18, 'rss'],
    [{ hasBylines: true },         16, 'bylines'],
    [{ hasComments: true },        12, 'comments'],
    [{ hasCorrections: true },     14, 'corrections'],
    [{ hasContact: true },         10, 'contact'],
    [{ hasEditorialPolicy: true }, 12, 'editorial'],
    [{ hasCreativeCommons: true }, 10, 'cc_license'],
    [{ altRatio: 0.8 },             5, 'alt_text'],
    [{ hasMain: true },             3, 'landmarks'],
  ];
  for (const [override, points, id] of cases) {
    test(`${id} alone contributes exactly ${points} points`, async () => {
      const result = await score(makeDom(override));
      assert.equal(result.dimensions.participation, points);
      assert.ok(signalIds(result.signals.participationSignals).includes(id));
      assert.ok(result.signals.participationSignals.find(s => s.id === id).positive);
    });
  }

  test('altRatio at exactly 0.7 does NOT earn alt_text points (strict >)', async () => {
    const result = await score(makeDom({ altRatio: 0.7 }));
    assert.equal(result.dimensions.participation, 0);
    assert.ok(signalIds(result.signals.participationSignals).includes('poor_alt_text'));
  });

  test('all positive signals sum to exactly 100, in pinned order', async () => {
    const result = await score(makeDom({
      hasRss: true, hasBylines: true, hasComments: true, hasCorrections: true,
      hasContact: true, hasEditorialPolicy: true, hasCreativeCommons: true,
      altRatio: 0.9, hasMain: true,
    }));
    assert.equal(result.dimensions.participation, 100);
    assert.deepEqual(signalIds(result.signals.participationSignals), [
      'rss', 'bylines', 'comments', 'corrections', 'contact',
      'editorial', 'cc_license', 'alt_text', 'landmarks',
    ]);
  });

  test('probe overrides upgrade missing DOM signals (rss + editorial → 30)', async () => {
    const result = await score(makeDom(), [], {
      rss: { found: true, url: 'https://example.com/feed' },
      editorial: { about: false, editorial: true, corrections: false, contact: false },
    });
    assert.equal(result.dimensions.participation, 30); // 18 + 12
    assert.equal(result.signals.hasRss, true);
    assert.equal(result.signals.hasEditorialPolicy, true);
  });
});

// ── Dimension 3: AI Editorial Infrastructure ─────────────────────────────────

describe('aiEditorial dimension', () => {
  test('positive: Taboola tracker → algo_recs, −35 → 65', async () => {
    const result = await score(makeDom(), [tracker('Taboola', 'advertising')]);
    assert.equal(result.dimensions.aiEditorial, 65);
    assert.deepEqual(signalIds(result.signals.aiSignals), ['algo_recs']);
  });

  test('positive: personalisation engine (Dynamic Yield) → −22 → 78', async () => {
    const result = await score(makeDom(), [tracker('Dynamic Yield', 'personalisation')]);
    assert.equal(result.dimensions.aiEditorial, 78);
    assert.deepEqual(signalIds(result.signals.aiSignals), ['personalisation']);
  });

  test('positive: predictive paywall (Zuora) → −18 → 82', async () => {
    const result = await score(makeDom(), [tracker('Zuora', 'paywall')]);
    assert.equal(result.dimensions.aiEditorial, 82);
    assert.deepEqual(signalIds(result.signals.aiSignals), ['ai_paywall']);
  });

  test('characterization: Piano triggers BOTH personalisation and ai_paywall → 60', async () => {
    const result = await score(makeDom(), [tracker('Piano', 'paywall')]);
    assert.equal(result.dimensions.aiEditorial, 60); // 100 − 22 − 18
    assert.deepEqual(signalIds(result.signals.aiSignals), ['personalisation', 'ai_paywall']);
  });

  test('positive: headline A/B testing category → −15 → 85', async () => {
    const result = await score(makeDom(), [tracker('Optimizely', 'ab_testing')]);
    assert.equal(result.dimensions.aiEditorial, 85);
    assert.deepEqual(signalIds(result.signals.aiSignals), ['headline_testing']);
  });

  test('positive: DOM-only recommendation widgets (no Taboola tracker) → −12 → 88', async () => {
    const result = await score(makeDom({ hasAlgoWidgets: true }));
    assert.equal(result.dimensions.aiEditorial, 88);
    assert.deepEqual(signalIds(result.signals.aiSignals), ['algo_widgets']);
  });

  test('positive: editorial analytics (Chartbeat) → −8 → 92', async () => {
    const result = await score(makeDom(), [tracker('Chartbeat', 'editorial_analytics')]);
    assert.equal(result.dimensions.aiEditorial, 92);
    assert.deepEqual(signalIds(result.signals.aiSignals), ['editorial_analytics']);
  });

  test('AI disclosure is informational only — no score deduction', async () => {
    const result = await score(makeDom({ aiDisclosures: ['ai-generated'] }));
    assert.equal(result.dimensions.aiEditorial, 100);
    assert.deepEqual(signalIds(result.signals.aiSignals), ['ai_disclosure']);
  });

  test('negative: no AI systems → no_ai_detected, 100', async () => {
    const result = await score(makeDom(), [tracker('Plausible', 'analytics')]);
    assert.equal(result.dimensions.aiEditorial, 100);
    assert.deepEqual(signalIds(result.signals.aiSignals), ['no_ai_detected']);
  });
});

// ── Composite openness score (35% access + 35% participation + 30% ai) ───────

test('golden composite fixture: metered wall + rss/bylines/corrections + Taboola → 61', async () => {
  // access 70, participation 18+16+14 = 48, aiEditorial 65
  // 70*0.35 + 48*0.35 + 65*0.30 = 24.5 + 16.8 + 19.5 = 60.8 → 61
  const result = await score(
    makeDom({
      meteredPaywall: ['free articles left'],
      hasRss: true, hasBylines: true, hasCorrections: true,
    }),
    [tracker('Taboola', 'advertising')]
  );
  assert.deepEqual(result.dimensions, { access: 70, participation: 48, aiEditorial: 65 });
  assert.equal(result.overall, 61);
  assert.equal(result.signals.wallType, 'metered');
  assert.deepEqual(result.signals.wallSignals, ['free articles left']);
  assert.equal(result.signals.hasRss, true);
  assert.equal(result.signals.hasBylines, true);
  assert.equal(result.signals.hasCorrections, true);
});

// ── Grade bands (A≥80, B≥65, C≥45, D≥25, else F) ─────────────────────────────

describe('opennessGrade bands', () => {
  const cases = [
    [100,  'A', 'Open & Accountable', 'green'],
    [80,   'A', 'Open & Accountable', 'green'],
    [79.9, 'B', 'Partially Open',     'lime'],
    [65,   'B', 'Partially Open',     'lime'],
    [64.9, 'C', 'Restricted',         'amber'],
    [45,   'C', 'Restricted',         'amber'],
    [44.9, 'D', 'Closed',             'orange'],
    [25,   'D', 'Closed',             'orange'],
    [24.9, 'F', 'Opaque & Gated',     'red'],
    [0,    'F', 'Opaque & Gated',     'red'],
  ];
  for (const [value, grade, label, colorClass] of cases) {
    test(`opennessGrade(${value}) → ${grade} "${label}"`, () => {
      assert.deepEqual(opennessGrade(value), { grade, label, colorClass });
    });
  }
});
