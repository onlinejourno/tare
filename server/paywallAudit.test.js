'use strict';

// Regression tests for server/paywallAudit.js.
//
// auditPaywall(page, allRequests, trackers, opennessSignals) reads the
// wall-type classification from the openness signals object (the `signals`
// field of analyzeOpenness's result, whose wall field is `wallType`).
// A field-name mismatch here previously left paywallType permanently 'none',
// silencing every paywall-type penalty — these tests pin the wiring.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { auditPaywall } = require('./paywallAudit');

// ── Fixture helpers ───────────────────────────────────────────────────────────

// DOM signals as returned by the in-page evaluate. Defaults chosen so no
// DOM-driven bonus/penalty fires except what a test overrides.
function makeDom(overrides = {}) {
  return {
    paywallVisible: false, hasLoginLink: true, loginLinkText: 'Sign in',
    hasPricing: false, hasGiftOption: false, hasMeterCounter: false,
    hasManageSubscription: false, visibleArticleParagraphs: 10,
    ...overrides,
  };
}

function audit({ dom = makeDom(), requests = [], trackers = [], signals } = {}) {
  const fakePage = { evaluate: async () => dom };
  return auditPaywall(fakePage, requests, trackers, signals);
}

// ── Wall type wiring from openness signals ────────────────────────────────────

describe('paywall type from openness signals', () => {
  test('hard paywall in openness signals triggers audit and penalties (no platform requests)', async () => {
    const result = await audit({ signals: { wallType: 'hard' } });
    // Skip guard must not fire: a content-detected paywall alone is auditable.
    assert.notEqual(result, null);
    assert.equal(result.paywallType, 'hard');
    // transparency: 50 +20 login −20 hard = 50; readerRespect: 80 −40 hard = 40
    assert.equal(result.dimensions.transparency, 50);
    assert.equal(result.dimensions.readerRespect, 40);
  });

  test('registration wall applies its readerRespect penalty', async () => {
    const result = await audit({ signals: { wallType: 'registration' } });
    assert.equal(result.paywallType, 'registration');
    assert.equal(result.dimensions.readerRespect, 60); // 80 − 20
  });

  test('metered wall gets its transparency bonus', async () => {
    const result = await audit({ signals: { wallType: 'metered' } });
    assert.equal(result.paywallType, 'metered');
    assert.equal(result.dimensions.transparency, 75); // 50 + 20 login + 5 metered
  });

  test('no platform and no wall → null (section skipped)', async () => {
    assert.equal(await audit({ signals: { wallType: 'none' } }), null);
    assert.equal(await audit({ signals: undefined }), null);
  });

  test('hard wall with sparse visible article text stacks the hidden-content penalty', async () => {
    const result = await audit({
      dom: makeDom({ visibleArticleParagraphs: 0 }),
      signals: { wallType: 'hard' },
    });
    assert.equal(result.dimensions.readerRespect, 25); // 80 − 40 hard − 15 sparse
  });
});

// ── Platform-request path (audit triggered without a content wall) ────────────
// hasAnyPaywallPlatform is the *other* trigger for the skip guard: a detected
// platform domain makes the section run even when wallType is 'none'.

describe('platform detection path', () => {
  test('Piano request with no content wall triggers audit and profiling penalty', async () => {
    const result = await audit({
      requests: [{ url: 'https://piano.io/api/v3/offer' }],
      signals: { wallType: 'none' },
    });
    assert.notEqual(result, null);          // skip guard bypassed by platform, not wall
    assert.equal(result.paywallType, 'none');
    assert.equal(result.detected, true);
    assert.equal(result.platform, 'Piano');
    assert.equal(result.hasPiano, true);
    assert.equal(result.profilesPlatform, true);
    assert.equal(result.signals.totalPlatformCalls, 1);
    // readerRespect: 80 − 15 profiling (no hard/reg penalty, no sparse guard at 'none')
    assert.equal(result.dimensions.readerRespect, 65);
    // transparency: 50 + 20 login (no surveillance endpoint → no −15 profiling-undisclosed)
    assert.equal(result.dimensions.transparency, 70);
  });

  test('billing-only platform (Stripe) detected without profiling penalty', async () => {
    const result = await audit({
      requests: [{ url: 'https://stripe.com/checkout' }],
      signals: { wallType: 'none' },
    });
    assert.notEqual(result, null);
    assert.equal(result.platform, 'Stripe');
    assert.equal(result.profilesPlatform, false); // Stripe profiles: false
    assert.equal(result.dimensions.readerRespect, 80); // no profiling deduction
  });

  test('editorial_ai tracker alone triggers audit with no platform request', async () => {
    const result = await audit({
      trackers: [{ name: 'OutbrainReco', category: 'editorial_ai', severity: 'high' }],
      signals: { wallType: 'none' },
    });
    assert.notEqual(result, null);
    assert.equal(result.platform, 'OutbrainReco');
    assert.equal(result.profilesPlatform, true); // high-severity editorial_ai tracker
    assert.equal(result.signals.totalPlatformCalls, 0); // tracker, not a request
  });
});
