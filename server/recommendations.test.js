'use strict';

// Characterization tests for server/recommendations.js.
// Pins the highest-severity recommendation triggers and the rec object shape.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { generateRecommendations } = require('./recommendations');

const clean = (o = {}) => ({
  trackers: [],
  coverage: { jsTotalBytes: 0, jsUnusedBytes: 0, cssTotalBytes: 0, cssUnusedBytes: 0 },
  assets: { totalTransferBytes: 0, images: [], fonts: [] },
  requests: { total: 0, thirdPartyCount: 0 },
  rtbCascade: { count: 0, headerBiddingDetected: false, uniqueParticipants: 0, participantNames: [] },
  consentAudit: { consentBannerDetected: true, trackersFireBeforeConsent: false, preConsentThirdPartyCount: 0 },
  googleAttribution: { isDoubleBind: false },
  ...o,
});

const ids = (recs) => recs.map(r => r.id);

describe('generateRecommendations', () => {
  test('a clean Publication triggers no critical tracker recommendations', () => {
    const recs = generateRecommendations(clean());
    assert.ok(Array.isArray(recs));
    assert.ok(!ids(recs).includes('rtb-auction'));
    assert.ok(!ids(recs).includes('identity-resolution'));
  });

  test('a real-time bidding cascade yields a critical rtb-auction recommendation', () => {
    const recs = generateRecommendations(clean({
      rtbCascade: { count: 1, headerBiddingDetected: true, uniqueParticipants: 3, participantNames: ['PubMatic', 'Magnite', 'Index'] },
    }));
    const rtb = recs.find(r => r.id === 'rtb-auction');
    assert.ok(rtb, 'expected an rtb-auction rec');
    assert.equal(rtb.severity, 'critical');
    assert.ok(Array.isArray(rtb.alternatives));
  });

  test('an identity-resolution tracker yields its critical recommendation', () => {
    const recs = generateRecommendations(clean({
      trackers: [{ category: 'identity_resolution', name: 'LiveRamp' }],
    }));
    assert.ok(ids(recs).includes('identity-resolution'));
  });

  test('every recommendation has the id/severity/title/detail contract', () => {
    const recs = generateRecommendations(clean({
      trackers: [{ category: 'data_broker', name: 'Lotame' }, { category: 'fingerprinting', name: 'Hotjar' }],
    }));
    assert.ok(recs.length > 0);
    for (const r of recs) {
      for (const key of ['id', 'severity', 'title', 'detail']) {
        assert.ok(r[key], `rec ${r.id} missing ${key}`);
      }
    }
  });
});
