'use strict';

// Golden/characterization tests for server/darkPatterns.js.
//
// detectDarkPatterns(page) only uses the page to run one page.evaluate();
// all pattern classification, severity assignment, and scoring happen
// Node-side on the returned data. So each detector is driven here with a
// synthetic evaluate() result — one positive and one negative fixture per
// pattern — with no browser needed. detectAdBlockerWall's wall-type
// classification is exercised the same way via a stub browser/page.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { detectDarkPatterns, detectAdBlockerWall } = require('./darkPatterns');

// ── Fixture helpers ───────────────────────────────────────────────────────────

function fakePage(evalResult) {
  return { evaluate: async () => evalResult };
}

// A banner element as produced by the in-page evaluate mapping.
function el(text, extra = {}) {
  return {
    text, tag: 'button',
    bgColor: 'rgb(0, 100, 0)', color: 'rgb(255, 255, 255)',
    fontSize: 14, fontWeight: 400,
    hasBg: true, hasBorder: false, visible: true,
    width: 100, height: 36,
    ...extra,
  };
}

function banner({ elements = [], pretickedCount = 0, totalCheckboxes = 0, bannerText = '' } = {}) {
  return { bannerFound: true, elements, pretickedCount, totalCheckboxes, bannerText };
}

const patternIds = (result) => result.patterns.map(p => p.id);

// ── Detector ID registry pin ─────────────────────────────────────────────────
// Adding or removing a dark-pattern detector must be a visible diff here.

test('pins the exact list of dark-pattern detector IDs in darkPatterns.js', () => {
  const src = fs.readFileSync(path.join(__dirname, 'darkPatterns.js'), 'utf8');
  const ids = [...src.matchAll(/^\s*id: '([a-z_]+)',$/gm)].map(m => m[1]);
  assert.deepEqual(ids, [
    'no_reject_option',
    'reject_requires_extra_clicks',
    'preticked_boxes',
    'reject_as_link_only',
    'visual_asymmetry',
    'legitimate_interest_no_opt_out',
  ]);
});

// ── Baselines ────────────────────────────────────────────────────────────────

describe('detectDarkPatterns baselines', () => {
  test('no banner found → score 100, no patterns', async () => {
    const result = await detectDarkPatterns(fakePage({ bannerFound: false }));
    assert.deepEqual(result, {
      bannerFound: false, patterns: [], score: 100, summary: 'No consent banner found',
    });
  });

  test('evaluate throwing → graceful score-100 fallback', async () => {
    const page = { evaluate: async () => { throw new Error('detached frame'); } };
    const result = await detectDarkPatterns(page);
    assert.equal(result.bannerFound, false);
    assert.equal(result.score, 100);
    assert.equal(result.summary, 'Could not analyse consent interface');
    assert.equal(result.error, 'detached frame');
  });

  test('fair banner (symmetric accept + reject buttons) → no patterns, score 100', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all'), el('reject all')],
    })));
    assert.equal(result.bannerFound, true);
    assert.deepEqual(result.patterns, []);
    assert.equal(result.patternCount, 0);
    assert.equal(result.score, 100);
    assert.equal(result.hasNoRejectOption, false);
    assert.equal(result.acceptButtonCount, 1);
    assert.equal(result.rejectButtonCount, 1);
    assert.equal(result.summary, 'Consent interface appears fair — reject option clearly available');
  });
});

// ── Pattern 1: no_reject_option (critical, −30) ──────────────────────────────

describe('no_reject_option', () => {
  test('positive: accept button with no reject anywhere', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all')],
    })));
    assert.deepEqual(patternIds(result), ['no_reject_option']);
    assert.equal(result.patterns[0].severity, 'critical');
    assert.equal(result.score, 70);
    assert.equal(result.hasNoRejectOption, true);
    assert.equal(result.summary, '1 dark pattern detected in consent UI');
  });

  test('negative: a reject button present → not flagged', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all'), el('reject all')],
    })));
    assert.ok(!patternIds(result).includes('no_reject_option'));
  });
});

// ── Pattern 2: reject_requires_extra_clicks (high, −18) ──────────────────────

describe('reject_requires_extra_clicks', () => {
  test('positive: manage-preferences-only banner (no accept, no reject)', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('manage preferences')],
    })));
    assert.deepEqual(patternIds(result), ['reject_requires_extra_clicks']);
    assert.equal(result.patterns[0].severity, 'high');
    assert.equal(result.score, 82);
  });

  test('negative: accept present → pattern 1 fires instead (else-if guard)', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all'), el('manage preferences')],
    })));
    assert.deepEqual(patternIds(result), ['no_reject_option']);
  });
});

// ── Pattern 3: preticked_boxes (critical, −30) ───────────────────────────────

describe('preticked_boxes', () => {
  test('positive: 2 of 5 checkboxes pre-ticked', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all'), el('reject all')],
      pretickedCount: 2, totalCheckboxes: 5,
    })));
    assert.deepEqual(patternIds(result), ['preticked_boxes']);
    assert.equal(result.patterns[0].severity, 'critical');
    assert.equal(result.patterns[0].label, 'Pre-ticked Consent Boxes (2/5)');
    assert.equal(result.score, 70);
    assert.equal(result.pretickedBoxes, 2);
  });

  test('negative: checkboxes present but none pre-ticked', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all'), el('reject all')],
      pretickedCount: 0, totalCheckboxes: 5,
    })));
    assert.ok(!patternIds(result).includes('preticked_boxes'));
  });
});

// ── Pattern 4: reject_as_link_only (high, −18) ───────────────────────────────

describe('reject_as_link_only', () => {
  test('positive: styled accept button vs reject as plain <a> link', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [
        el('accept all', { hasBg: true }),
        el('reject all', { tag: 'a', hasBg: false }),
      ],
    })));
    assert.deepEqual(patternIds(result), ['reject_as_link_only']);
    assert.equal(result.patterns[0].severity, 'high');
    assert.equal(result.score, 82);
  });

  test('negative: reject is a real button → not flagged', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all', { hasBg: true }), el('reject all')],
    })));
    assert.ok(!patternIds(result).includes('reject_as_link_only'));
  });
});

// ── Pattern 5: visual_asymmetry (medium, −8) ─────────────────────────────────

describe('visual_asymmetry', () => {
  test('positive (font): accept 4px larger than reject', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all', { fontSize: 18 }), el('reject all', { fontSize: 14 })],
    })));
    assert.deepEqual(patternIds(result), ['visual_asymmetry']);
    assert.equal(result.patterns[0].severity, 'medium');
    assert.equal(result.score, 92);
    assert.match(result.patterns[0].description, /4px larger/);
  });

  test('positive (area): accept over 500px² larger at equal font size', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [
        el('accept all', { width: 200, height: 40 }),  // 8000 px²
        el('reject all', { width: 80,  height: 30 }),  // 2400 px²
      ],
    })));
    assert.deepEqual(patternIds(result), ['visual_asymmetry']);
    assert.match(result.patterns[0].description, /physically larger/);
  });

  test('negative: identical buttons → not flagged', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all'), el('reject all')],
    })));
    assert.ok(!patternIds(result).includes('visual_asymmetry'));
  });
});

// ── Pattern 6: legitimate_interest_no_opt_out (high, −18) ────────────────────

describe('legitimate_interest_no_opt_out', () => {
  test('positive: "legitimate interest" text with no reject option (stacks with pattern 1)', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all')],
      bannerText: 'we and our partners process data based on legitimate interest',
    })));
    assert.deepEqual(patternIds(result), ['no_reject_option', 'legitimate_interest_no_opt_out']);
    assert.equal(result.patterns[1].severity, 'high');
    assert.equal(result.score, 52); // 100 − 30 (critical) − 18 (high)
    assert.equal(result.summary, '2 dark patterns detected in consent UI');
  });

  test('negative: same text but a reject option exists → not flagged', async () => {
    const result = await detectDarkPatterns(fakePage(banner({
      elements: [el('accept all'), el('reject all')],
      bannerText: 'we and our partners process data based on legitimate interest',
    })));
    assert.deepEqual(patternIds(result), []);
  });
});

// ── Ad blocker wall classification (hard | message | overlay | none) ─────────

function fakeBrowser({ detection, blockedUrls = [] }) {
  let handler = null;
  const page = {
    route: async (_pattern, h) => { handler = h; },
    goto: async () => {
      for (const url of blockedUrls) {
        handler({ request: () => ({ url: () => url }), abort() {}, continue() {} });
      }
    },
    waitForTimeout: async () => {},
    evaluate: async () => detection,
  };
  return {
    newContext: async () => ({ newPage: async () => page, close: async () => {} }),
  };
}

const detection = (overrides = {}) => ({
  matchedPhrases: [], selectorHits: [], overlayCount: 0,
  bodyLength: 5000, pageTitle: 'Test',
  ...overrides,
});

describe('detectAdBlockerWall classification', () => {
  test('no signals → wallType none, not detected', async () => {
    const result = await detectAdBlockerWall('https://example.com', fakeBrowser({
      detection: detection(),
      blockedUrls: ['https://securepubads.doubleclick.net/tag.js'],
    }));
    assert.equal(result.wallDetected, false);
    assert.equal(result.wallType, 'none');
    assert.equal(result.blockedRequests, 1);
    assert.equal(result.summary, 'No ad blocker wall detected (1 ad requests blocked silently)');
  });

  test('anti-adblock phrase → wallType message', async () => {
    const result = await detectAdBlockerWall('https://example.com', fakeBrowser({
      detection: detection({ matchedPhrases: ['ad blocker detected'] }),
    }));
    assert.equal(result.wallDetected, true);
    assert.equal(result.wallType, 'message');
    assert.equal(result.summary, 'Message wall: "ad blocker detected"');
  });

  test('anti-adblock selector hit → wallType overlay', async () => {
    const result = await detectAdBlockerWall('https://example.com', fakeBrowser({
      detection: detection({ selectorHits: ['[class*="adblock"]'] }),
    }));
    assert.equal(result.wallDetected, true);
    assert.equal(result.wallType, 'overlay');
  });

  test('near-empty body with 3+ blocked ad requests → wallType hard (takes precedence)', async () => {
    const result = await detectAdBlockerWall('https://example.com', fakeBrowser({
      detection: detection({ bodyLength: 200, matchedPhrases: ['adblock detected'] }),
      blockedUrls: [
        'https://securepubads.doubleclick.net/tag.js',
        'https://pagead2.googlesyndication.com/ads.js',
        'https://ads.pubmatic.com/bid.js',
      ],
    }));
    assert.equal(result.wallDetected, true);
    assert.equal(result.wallType, 'hard');
    assert.equal(result.blockedRequests, 3);
    assert.equal(result.summary, 'Hard block: content is hidden or removed when ads are blocked');
  });
});
