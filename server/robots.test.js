'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Served by the express.static mount in index.js, so this asserts the shipped
// file rather than a route: if the file moves, static stops serving it and the
// endpoints silently become crawlable again.
const ROBOTS = path.join(__dirname, '..', 'public', 'robots.txt');

test('robots.txt is shipped in the static directory', () => {
  assert.ok(fs.existsSync(ROBOTS), 'public/robots.txt must exist to be served');
});

test('robots.txt disallows every expensive endpoint', () => {
  const body = fs.readFileSync(ROBOTS, 'utf8');
  for (const rule of ['Disallow: /api/', 'Disallow: /classify', 'Disallow: /score']) {
    assert.ok(body.includes(rule), `missing ${rule}`);
  }
});

test('robots.txt still lets the landing page be indexed', () => {
  const body = fs.readFileSync(ROBOTS, 'utf8');
  assert.match(body, /^User-agent: \*$/m);
  assert.match(body, /^Allow: \/\$$/m);
});

test('robots.txt does not blanket-allow', () => {
  const body = fs.readFileSync(ROBOTS, 'utf8');
  assert.ok(!/^Allow: \/$/m.test(body), 'a bare `Allow: /` would re-open the endpoints');
});
