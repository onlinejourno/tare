'use strict';

// Signal Probes — scheduling + the upgrade-only merge. The merge is the
// CONTEXT.md invariant "layers only upgrade signals — never downgrade",
// previously hand-written in two places (analyzeOpenness and POST /score).
// Network tests use a private/metadata hostname so the SSRF guard inside
// _fetch short-circuits every request — deterministic with no network.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { startSignalProbes, upgradeDomSignals } = require('./signalProbes');

const ALL_PROBES_POSITIVE = {
  rss:      { found: true, url: 'https://example.com/feed' },
  editorial: { about: true, editorial: true, corrections: true, contact: true },
  article:  { hasBylines: true, hasCorrections: true, hasContact: true },
};

describe('upgradeDomSignals', () => {
  test('upgrades every signal the probes found and the DOM missed', () => {
    const dom = upgradeDomSignals({}, ALL_PROBES_POSITIVE);
    assert.deepEqual(dom, {
      hasRss: true,
      hasAbout: true,
      hasEditorialPolicy: true,
      hasCorrections: true,
      hasContact: true,
      hasBylines: true,
    });
  });

  test('never downgrades: negative probes leave DOM-found signals intact', () => {
    const dom = {
      hasRss: true, hasAbout: true, hasEditorialPolicy: true,
      hasCorrections: true, hasContact: true, hasBylines: true,
    };
    const negative = {
      rss:      { found: false },
      editorial: { about: false, editorial: false, corrections: false, contact: false },
      article:  { hasBylines: false, hasCorrections: false, hasContact: false },
    };
    assert.deepEqual(upgradeDomSignals({ ...dom }, negative), dom);
  });

  test('absent or partial probe results are no-ops', () => {
    assert.deepEqual(upgradeDomSignals({}, {}), {});
    assert.deepEqual(upgradeDomSignals({}, undefined), {});
    assert.deepEqual(upgradeDomSignals({}, { rss: { found: true } }), { hasRss: true });
  });

  test('mutates and returns the same domData object', () => {
    const dom = {};
    assert.strictEqual(upgradeDomSignals(dom, ALL_PROBES_POSITIVE), dom);
  });
});

describe('startSignalProbes (hermetic via SSRF short-circuit)', () => {
  test('unparseable URL resolves all-negative without fetching', async () => {
    const r = await startSignalProbes('not a url');
    assert.deepEqual(r, {
      rss:      { found: false },
      editorial: { about: false, editorial: false, corrections: false, contact: false },
      article:  { hasBylines: false, hasCorrections: false, hasContact: false },
    });
  });

  test('private hostname: guard blocks every probe, deep path gate included', async () => {
    // path depth 2 → Article Signal Probe scheduled; guard blocks all sockets.
    const r = await startSignalProbes('http://169.254.169.254/section/story');
    assert.deepEqual(r.rss, { found: false });
    assert.deepEqual(r.editorial, { about: false, editorial: false, corrections: false, contact: false });
    assert.deepEqual(r.article, { hasBylines: false, hasCorrections: false, hasContact: false });
  });

  test('shallow path (depth < 2) skips the Article Signal Probe', async () => {
    const r = await startSignalProbes('http://169.254.169.254/');
    assert.deepEqual(r.article, { hasBylines: false, hasCorrections: false, hasContact: false });
  });
});
