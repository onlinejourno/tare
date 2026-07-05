'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isPrivateHostname, validateUrl, guardedLookup } = require('./ssrfGuard');
const { probeRssFeeds } = require('./openness');

test('isPrivateHostname blocks private / loopback / metadata / CGNAT', () => {
  for (const h of [
    'localhost', '127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1',
    '169.254.169.254', '100.64.0.1', '100.127.255.255',
    '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '0.0.0.0',
  ]) {
    assert.strictEqual(isPrivateHostname(h), true, `${h} should be private`);
  }
});

test('isPrivateHostname allows public hosts', () => {
  for (const h of ['example.com', '93.184.216.34', '1.1.1.1', '8.8.8.8', '100.128.0.1']) {
    assert.strictEqual(isPrivateHostname(h), false, `${h} should be public`);
  }
});

test('validateUrl rejects non-http(s) schemes', async () => {
  await assert.rejects(validateUrl('file:///etc/passwd'));
  await assert.rejects(validateUrl('ftp://example.com/'));
  await assert.rejects(validateUrl('not a url'));
});

test('validateUrl rejects literal private/metadata IPs', async () => {
  await assert.rejects(validateUrl('http://169.254.169.254/latest/meta-data/'));
  await assert.rejects(validateUrl('http://127.0.0.1/'));
  await assert.rejects(validateUrl('http://10.0.0.5/'));
});

test('validateUrl allows a public literal IP', async () => {
  const ok = await validateUrl('http://93.184.216.34/');
  assert.match(ok, /93\.184\.216\.34/);
});

test('guardedLookup refuses hostnames resolving to private addresses', (t, done) => {
  // localhost resolves locally (no external DNS) — must be blocked at connect time.
  guardedLookup('localhost', {}, (err) => {
    assert.ok(err, 'localhost must be rejected');
    assert.match(err.message, /private/i);
    done();
  });
});

test('probe fetch path never touches private or non-http targets', async () => {
  // Private hostname → the guarded _fetch resolves every probe as status 0,
  // so the RSS probe reports "not found" without any socket being opened.
  const r = await probeRssFeeds('169.254.169.254');
  assert.deepStrictEqual(r, { found: false });
});
