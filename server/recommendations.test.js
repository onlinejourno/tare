'use strict';

// Google double-bind recommendation — the percent sentence must only appear
// when the attribution actually carries numbers (Live Browser mode sends
// only { isDoubleBind }, which previously interpolated "undefined%").

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { generateRecommendations } = require('./recommendations');

const base = { trackers: [], coverage: {}, assets: {}, requests: {}, performanceMetrics: {} };

describe('google double-bind detail', () => {
  test('headless attribution includes the percentages', () => {
    const recs = generateRecommendations({
      ...base,
      googleAttribution: { isDoubleBind: true, requestPercent: 41, bytesPercent: 37 },
    });
    const rec = recs.find(r => r.id === 'google-double-bind');
    assert.ok(rec);
    assert.ok(rec.detail.includes('41% of all requests'));
  });

  test('live-browser attribution ({isDoubleBind} only) omits the sentence, no "undefined"', () => {
    const recs = generateRecommendations({ ...base, googleAttribution: { isDoubleBind: true } });
    const rec = recs.find(r => r.id === 'google-double-bind');
    assert.ok(rec);
    assert.ok(!rec.detail.includes('undefined'));
    assert.ok(!rec.detail.includes('% of all requests'));
  });
});
