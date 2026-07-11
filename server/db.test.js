'use strict';

// Analysis store — real schema and prepared statements against an in-memory
// SQLite database via createStore(':memory:'). No filesystem side effects.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { createStore } = require('./db-sqlite');

function fixtureResult(overrides = {}) {
  return {
    scores: {
      overall: 65,
      overallGrade: { grade: 'B', label: 'Moderate', colorClass: 'lime' },
      dimensions: {
        surveillance: 62, adTechDepth: 64, consentPaywallIntegrity: 62,
        pageBloat: 73, openness: 55, performance: 80,
      },
      openness: 55,
      flags: [{ id: 'no_rss', severity: 'low', label: 'No RSS Feed', note: 'drop me on save' }],
    },
    recommendations: [],
    ...overrides,
  };
}

describe('Analysis store (in-memory)', () => {
  let store;
  beforeEach(() => { store = createStore(':memory:'); });

  test('saveAnalysis → getAnalysis round-trip', () => {
    store.saveAnalysis('run-1', 'https://www.example.com/story', 'headless', fixtureResult(), true);
    const row = store.getAnalysis('run-1');
    assert.equal(row.hostname, 'example.com');            // www-stripped canonical Publication id
    assert.equal(row.mode, 'headless');
    assert.equal(row.score_overall, 65);
    assert.equal(row.score_consent_paywall, 62);
    assert.equal(row.score_openness, 55);
    assert.equal(row.grade, 'B');
    assert.equal(row.cloudflare_blocked, true);
    assert.deepEqual(row.flags, [{ id: 'no_rss', severity: 'low', label: 'No RSS Feed' }]); // note projected away
    assert.equal(row.result.scores.overall, 65);          // full blob round-trips
    assert.equal(store.getAnalysis('missing'), null);
  });

  test('same run_id replaces, not duplicates', () => {
    store.saveAnalysis('run-1', 'https://example.com/', 'headless', fixtureResult());
    store.saveAnalysis('run-1', 'https://example.com/', 'headless',
      fixtureResult({ scores: { ...fixtureResult().scores, overall: 30 } }));
    const history = store.getPublicationHistory('example.com');
    assert.equal(history.length, 1);
    assert.equal(history[0].score_overall, 30);
  });

  test('getPublicationHistory / getLatestForPublication normalise www.', () => {
    store.saveAnalysis('run-1', 'https://example.com/a', 'headless', fixtureResult());
    store.saveAnalysis('run-2', 'https://www.example.com/b', 'live-browser', fixtureResult());
    assert.equal(store.getPublicationHistory('www.example.com').length, 2);
    const latest = store.getLatestForPublication('example.com');
    assert.ok(['run-1', 'run-2'].includes(latest.run_id));
  });

  test('listPublications: one row per Publication, worst score first', () => {
    store.saveAnalysis('a1', 'https://bad.example/', 'headless',
      fixtureResult({ scores: { ...fixtureResult().scores, overall: 20 } }));
    store.saveAnalysis('b1', 'https://good.example/', 'headless',
      fixtureResult({ scores: { ...fixtureResult().scores, overall: 90 } }));
    const pubs = store.listPublications();
    assert.equal(pubs.length, 2);
    assert.equal(pubs[0].hostname, 'bad.example');
    assert.equal(pubs[0].score_overall, 20);
    assert.equal(pubs[0].run_count, 1);
  });

  test('listRecent caps at n', () => {
    for (let i = 0; i < 5; i++) {
      store.saveAnalysis(`r${i}`, `https://p${i}.example/`, 'headless', fixtureResult());
    }
    assert.equal(store.listRecent(3).length, 3);
  });

  test('unparseable URL falls back to raw string as hostname', () => {
    store.saveAnalysis('run-x', 'not a url', 'live-browser', fixtureResult());
    assert.equal(store.getAnalysis('run-x').hostname, 'not a url');
  });
});

describe('additive DTO (camelCase alongside legacy snake_case)', () => {
  test('parsed rows carry both key sets with equal values', () => {
    const store = createStore(':memory:');
    store.saveAnalysis('run-dto', 'https://www.example.com/story', 'headless', fixtureResult(), true);
    const row = store.getAnalysis('run-dto');
    assert.equal(row.runId, row.run_id);
    assert.equal(row.analysedAt, row.analysed_at);
    assert.equal(row.scoreOverall, row.score_overall);
    assert.equal(row.scoreConsentPaywall, row.score_consent_paywall);
    assert.equal(row.scoreOpenness, row.score_openness);
    assert.equal(row.cloudflareBlocked, true);
    assert.equal(row.cloudflare_blocked, true);
  });

  test('listPublications rows carry runCount/lastAnalysed/scoreOverall', () => {
    const store = createStore(':memory:');
    store.saveAnalysis('r1', 'https://example.com/', 'headless', fixtureResult());
    const [pub] = store.listPublications();
    assert.equal(pub.runCount, pub.run_count);
    assert.equal(pub.lastAnalysed, pub.last_analysed);
    assert.equal(pub.scoreOverall, pub.score_overall);
  });
});
