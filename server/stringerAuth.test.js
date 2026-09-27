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

// --- Signed `created` ---------------------------------------------------
// The `stringer` member does not sign `created`, so a captured request replays
// until the key is revoked. A `stringer-v2` member signs it too.

const URL_ = 'https://tare.example/stringer/tare/latest';
const NOW = 1790000000;
const mac = (text, key = KEY) => crypto.createHmac('sha256', key).update(text).digest('base64');
const v2Params = (keyid, created) =>
  `(@method @target-uri content-digest);keyid="${keyid}";alg="hmac-sha256";created=${created}`;

// Both members, as current clients send them. `signedCreated` signs one
// `created` while presenting another: a forgery.
function signV2(method, url, created, { keyid = 'site-key-v1', signedCreated = created } = {}) {
  const digest = 'sha-256=' + crypto.createHash('sha256').update('').digest('base64');
  const base = `@method: ${method}\n@target-uri: ${url}\ncontent-digest: ${digest}`;
  const params = v2Params(keyid, created);
  const v2 = mac(`${base}\n@signature-params: ${v2Params(keyid, signedCreated)}`);
  return {
    'signature-input': `stringer=${params}, stringer-v2=${params}`,
    signature: `stringer=:${mac(base)}:, stringer-v2=:${v2}:`,
    'content-digest': digest,
  };
}

const verify = (headers, now = NOW) => verifyStringerSignature('GET', URL_, '', headers, KEY, now);

test('a fresh v2 request is accepted', () => {
  assert.equal(verify(signV2('GET', URL_, NOW)), true);
});

test('a v2 request with an empty keyid is accepted', () => {
  assert.equal(verify(signV2('GET', URL_, NOW, { keyid: '' })), true);
});

test('a replay older than the window is refused', () => {
  assert.equal(verify(signV2('GET', URL_, NOW - 301)), false);
});

test('a created too far ahead is refused', () => {
  assert.equal(verify(signV2('GET', URL_, NOW + 61)), false);
});

test('a forged created is refused', () => {
  assert.equal(verify(signV2('GET', URL_, NOW, { signedCreated: NOW - 3600 })), false);
});

test('a broken v2 member never falls back to v1', () => {
  // Each still carries a valid `stringer` member.
  const stale = signV2('GET', URL_, NOW - 3600);
  const badMac = signV2('GET', URL_, NOW);
  badMac.signature = badMac.signature.split(', stringer-v2=')[0] + ', stringer-v2=:AAAA:';
  const badParams = signV2('GET', URL_, NOW);
  badParams['signature-input'] = badParams['signature-input'].replace(
    'stringer-v2=(@method',
    'stringer-v2=(@method @authority',
  );
  for (const headers of [stale, badMac, badParams]) assert.equal(verify(headers), false);
});

test('a v1-only request is accepted during the rollout', () => {
  delete process.env.STRINGER_REQUIRE_SIGNED_CREATED;
  assert.equal(verify(sign('GET', URL_)), true);
});

test('a v1-only request is refused once signed created is required', (t) => {
  process.env.STRINGER_REQUIRE_SIGNED_CREATED = '1';
  t.after(() => delete process.env.STRINGER_REQUIRE_SIGNED_CREATED);
  assert.equal(verify(sign('GET', URL_)), false);
  assert.equal(verify(signV2('GET', URL_, NOW)), true);
});

test('the shared signing vector verifies', () => {
  // Shared Stringer signing vector: "POST with JSON body to localhost".
  const headers = {
    'signature-input':
      'stringer=(@method @target-uri content-digest);keyid="site-key-v1";alg="hmac-sha256";created=1790000000, stringer-v2=(@method @target-uri content-digest);keyid="site-key-v1";alg="hmac-sha256";created=1790000000',
    signature:
      'stringer=:kAsO15TpYQ69HHoHEg6w/ESPRSgEOpI44KEG5+zDWqc=:, stringer-v2=:RcizfEsfOlBSFaXhyQ87l18QaMONfRZM7XOhqRcuAto=:',
    'content-digest': 'sha-256=y56/TdC/n9uyVHikUirHX4dI4WVCnpQ9I89YAV3HLuo=',
  };
  const body = '{"claim_key":"health-check","title":"Test"}';
  assert.equal(
    verifyStringerSignature('POST', 'http://localhost:8000/brief/', body, headers, 'test-key-16-bytes!', 1790000000),
    true,
  );
});

const verifyKeyid = (headers, keyid) =>
  verifyStringerSignature('GET', URL_, '', headers, KEY, NOW, keyid);

test('a v2 keyid matching the configured one is accepted', () => {
  assert.equal(verifyKeyid(signV2('GET', URL_, NOW), 'site-key-v1'), true);
});

test('a v2 keyid other than the configured one is refused', () => {
  assert.equal(verifyKeyid(signV2('GET', URL_, NOW, { keyid: 'other' }), 'site-key-v1'), false);
  assert.equal(verifyKeyid(signV2('GET', URL_, NOW, { keyid: '' }), 'site-key-v1'), false);
});

test('an empty keyid is accepted when configured empty', () => {
  assert.equal(verifyKeyid(signV2('GET', URL_, NOW, { keyid: '' }), ''), true);
  assert.equal(verifyKeyid(signV2('GET', URL_, NOW), ''), false);
});
