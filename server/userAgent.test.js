'use strict';

// Tare names itself after its browser string, so a site that blocks unknown
// visitors at its edge can let Tare through by name. The browser string stays
// first: sites must serve Tare the page a reader gets, or the audit measures
// the wrong page.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { BROWSER_UA, TARE_TAG } = require('./userAgent');
const { version } = require('../package.json');

test('the tag is Tare and its version', () => {
  assert.strictEqual(TARE_TAG, `Tare/${version}`);
});

test('the browser string comes first and the tag last', () => {
  assert.match(BROWSER_UA, /^Mozilla\/5\.0 .*Chrome\/\d/);
  assert.ok(BROWSER_UA.endsWith(` ${TARE_TAG}`), BROWSER_UA);
});

test('no fetch site sends a bare Chrome string', () => {
  for (const f of ['analyzer.js', 'darkPatterns.js', 'signalProbes.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.ok(!/Safari\/537\.36'/.test(src), `${f} still hardcodes a browser string`);
  }
});

test('the probe UA carries the tag too', () => {
  const src = fs.readFileSync(path.join(__dirname, 'signalProbes.js'), 'utf8');
  assert.match(src, /const PROBE_UA\s*=\s*`[^`]*\$\{TARE_TAG\}`/);
});
