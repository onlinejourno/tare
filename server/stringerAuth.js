'use strict';

// Stringer HMAC-SHA256 signature verification.
//
// Written independently here rather than imported, deliberately: Tare is MIT,
// and it must stay installable and auditable on its own without pulling in
// anything from a private repository. The wire profile is small and frozen:
//
//   Signature-Input: stringer=(@method @target-uri content-digest);keyid="<id>";alg="hmac-sha256";created=<ts>
//   Signature:       stringer=:<base64-hmac>:
//   Content-Digest:  sha-256=<base64-sha256-of-body>
//
// signed over:
//
//   @method: <METHOD>
//   @target-uri: <FULL URL>
//   content-digest: <CONTENT-DIGEST>
//
// Signed `created`. That base does not cover
// `created`, so a captured request replays until the key is revoked. Current
// Stringer clients send a second member beside the first:
//
//   Signature-Input: stringer=<params>, stringer-v2=<params>
//   Signature:       stringer=:<v1>:, stringer-v2=:<v2>:
//
// whose base is the three lines above plus `@signature-params: <params>`, so
// keyid and created are signed. A request naming `stringer-v2` is judged by it
// alone, never falling back to the first member, and refused outside MAX_AGE /
// MAX_SKEW. A request without it (older clients) is still accepted while
// sites upgrade, unless STRINGER_REQUIRE_SIGNED_CREATED=1.

const crypto = require('node:crypto');

/**
 * The URL the caller addressed, which is what it signed.
 *
 * `req.protocol` and the bound host describe how this process was reached. A
 * TLS-terminating proxy reaches it over http:// while the caller signed
 * https://, so verifying against that rejects every correctly signed request —
 * and the resulting 401 is indistinguishable from a wrong key.
 *
 * These headers are caller-supplied and that buys an attacker nothing:
 * whichever URL they name still has to carry a valid HMAC under the site key.
 */
// Oldest a v2 request may be, and how far ahead of our clock its `created` may
// sit, in seconds. The client signs afresh on every attempt.
const MAX_AGE = 300;
const MAX_SKEW = 60;

// The v2 member's parameters exactly as the clients write them. Strict on
// purpose: this text is signed verbatim, so anything else is refused.
const V2_INPUT =
  /(?:^|,\s*)stringer-v2=(\(@method @target-uri content-digest\);keyid="([^"]*)";alg="hmac-sha256";created=(\d{1,12}))\s*(?:,|$)/;
const V2_NAMED = /(?:^|,\s*)stringer-v2=/;

function targetUriFor(req) {
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return req.originalUrl;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${proto}://${host}${req.originalUrl}`;
}

function _parse(header, label) {
  if (!header) return null;
  const m = String(header).match(new RegExp(`(?:^|,\\s*)${label}=:([^:]+):`));
  return m ? m[1] : null;
}

/**
 * True only for a request that carries a valid signature under `key`.
 *
 * Fails closed on every missing piece, and on an empty key: an unset
 * TARE_STRINGER_KEY must refuse everyone rather than admit whoever signs with
 * the empty string. `keyid`, when a string (empty included), is the only keyid
 * a v2 signature may name.
 */
function verifyStringerSignature(
  method,
  targetUri,
  body,
  headers,
  key,
  now = Date.now() / 1000,
  keyid = undefined,
) {
  if (!key) return false;

  const get = (n) => headers[n] ?? headers[n.toLowerCase()] ?? null;
  const signatureInput = get('signature-input');
  const signature = get('signature');
  const contentDigest = get('content-digest');
  if (!signatureInput || !signature || !contentDigest) return false;

  const expectedDigest =
    'sha-256=' + crypto.createHash('sha256').update(body ?? '').digest('base64');
  if (contentDigest !== expectedDigest) return false;

  const base = [
    `@method: ${String(method).toUpperCase()}`,
    `@target-uri: ${targetUri}`,
    `content-digest: ${contentDigest}`,
  ].join('\n');

  if (V2_NAMED.test(signatureInput)) {
    const params = String(signatureInput).match(V2_INPUT);
    const provided = _parse(signature, 'stringer-v2');
    if (!params || !provided) return false;
    if (!_same(key, `${base}\n@signature-params: ${params[1]}`, provided)) return false;
    if (typeof keyid === 'string' && params[2] !== keyid) return false;
    const age = now - Number(params[3]);
    return age <= MAX_AGE && age >= -MAX_SKEW;
  }

  if (process.env.STRINGER_REQUIRE_SIGNED_CREATED === '1') return false;
  const provided = _parse(signature, 'stringer');
  return Boolean(provided) && _same(key, base, provided);
}

function _same(key, base, provided) {
  const expected = crypto.createHmac('sha256', key).update(base).digest('base64');

  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a length mismatch rather than returning false.
  const a = Buffer.from(expected, 'base64');
  const b = Buffer.from(provided, 'base64');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { targetUriFor, verifyStringerSignature };
