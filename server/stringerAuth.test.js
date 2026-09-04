'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

const { targetUriFor, verifyStringerSignature } = require('./stringerAuth');

const KEY = 'test-site-key';

function sign(method, url, key = KEY) {
  const digest = 'sha-256=' + crypto.createHash('sha256').update('').digest('base64');
  const base = `@method: ${method}\n@target-uri: ${url}\ncontent-digest: ${digest}`;
  const sig = crypto.createHmac('sha256', key).update(base).digest('base64');
  return {
    'signature-input': `stringer=(@method @target-uri content-digest);keyid="newsroom-v1";alg="hmac-sha256";created=1`,
    signature: `stringer=:${sig}:`,
    'content-digest': digest,
  };
}

test('a correctly signed request is accepted', () => {
  const url = 'https://tare.example/stringer/tare/latest';
  assert.equal(verifyStringerSignature('GET', url, '', sign('GET', url), KEY), true);
});

test('a request signed with another key is refused', () => {
  const url = 'https://tare.example/stringer/tare/latest';
  assert.equal(verifyStringerSignature('GET', url, '', sign('GET', url, 'wrong'), KEY), false);
});

test('a signature for a different URL is refused', () => {
  // The signature covers @target-uri precisely so a valid signature cannot be
  // lifted from one endpoint and replayed against another.
  const headers = sign('GET', 'https://tare.example/stringer/tare/latest');
  assert.equal(
    verifyStringerSignature('GET', 'https://tare.example/stringer/tare/other', '', headers, KEY),
    false,
  );
});

test('missing headers are refused rather than treated as absent-and-fine', () => {
  const url = 'https://tare.example/stringer/tare/latest';
  for (const drop of ['signature-input', 'signature', 'content-digest']) {
    const headers = sign('GET', url);
    delete headers[drop];
    assert.equal(verifyStringerSignature('GET', url, '', headers, KEY), false, `missing ${drop}`);
  }
});

test('an empty key never authenticates anything', () => {
  // Fail closed. An unset TARE_STRINGER_KEY must refuse every caller, not
  // accept anyone who signs with the empty string.
  const url = 'https://tare.example/stringer/tare/latest';
  assert.equal(verifyStringerSignature('GET', url, '', sign('GET', url, ''), ''), false);
});

test('a tampered digest is refused', () => {
  const url = 'https://tare.example/stringer/tare/latest';
  const headers = sign('GET', url);
  headers['content-digest'] = 'sha-256=' + crypto.createHash('sha256').update('x').digest('base64');
  assert.equal(verifyStringerSignature('GET', url, '', headers, KEY), false);
});

test('the URL verified is the one the caller addressed', () => {
  // Fly terminates TLS, so the app is reached on http:// while the caller
  // signed https://. Verifying against the bound address rejects every correct
  // signature, and the 401 looks exactly like a wrong key.
  const req = {
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'tare.example' },
    protocol: 'http',
    get: (h) => req.headers[h.toLowerCase()],
    originalUrl: '/stringer/tare/latest',
  };
  assert.equal(targetUriFor(req), 'https://tare.example/stringer/tare/latest');
});

test('with no forwarding headers the request is verified as received', () => {
  const req = {
    headers: { host: 'localhost:3000' },
    protocol: 'http',
    get: (h) => req.headers[h.toLowerCase()],
    originalUrl: '/stringer/tare/latest',
  };
  assert.equal(targetUriFor(req), 'http://localhost:3000/stringer/tare/latest');
});
