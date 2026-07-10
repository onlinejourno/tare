'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isPrivateHostname, validateUrl, guardedLookup } = require('./ssrfGuard');
const { probeRssFeeds } = require('./signalProbes');

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

test('validateUrl allows a public literal IP', async (t) => {
  // Hermetic: stub the resolver so the test never calls getaddrinfo / touches the
  // network. A public literal IP must pass the guard and come back normalised.
  // (Node normally short-circuits dns.lookup for IP literals, but that is not
  // guaranteed on every sandboxed CI image — mock so the outcome is deterministic.)
  const dnsPromises = require('node:dns').promises;
  t.mock.method(dnsPromises, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  const ok = await validateUrl('http://93.184.216.34/');
  assert.match(ok, /93\.184\.216\.34/);
});

test('guardedLookup refuses hostnames resolving to private addresses', (t, done) => {
  // Hermetic: stub the resolver to return a private address (as localhost would
  // resolve locally via /etc/hosts) so the test never depends on DNS or a hosts
  // file. guardedLookup must reject any resolution to a private IP at connect time.
  const dnsMod = require('node:dns');
  t.mock.method(dnsMod, 'lookup', (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; }
    cb(null, [{ address: '127.0.0.1', family: 4 }]);
  });
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

// Regression — IPv4-mapped IPv6 that new URL() serialises to hex form.
// http://[::ffff:169.254.169.254]/ normalises to ::ffff:a9fe:a9fe, which the
// old dotted-only regex missed — reaching the cloud metadata endpoint.
test('isPrivateHostname blocks hex IPv4-mapped IPv6 literals', () => {
  for (const h of [
    '[::ffff:a9fe:a9fe]', '::ffff:a9fe:a9fe',   // 169.254.169.254 (metadata)
    '[::ffff:7f00:1]',    '::ffff:7f00:1',      // 127.0.0.1
    '::ffff:a00:1',                             // 10.0.0.1
  ]) {
    assert.strictEqual(isPrivateHostname(h), true, `${h} should be private`);
  }
});

// The mapped-decode must not over-block genuinely public IPv4-mapped targets.
test('isPrivateHostname allows public IPv4-mapped IPv6', () => {
  for (const h of ['[::ffff:8.8.8.8]', '::ffff:808:808']) {
    assert.strictEqual(isPrivateHostname(h), false, `${h} should be public`);
  }
});

// 0.0.0.0/8 beyond the single 0.0.0.0 address.
test('isPrivateHostname blocks the whole 0.0.0.0/8 range', () => {
  assert.strictEqual(isPrivateHostname('0.0.0.1'), true);
});
