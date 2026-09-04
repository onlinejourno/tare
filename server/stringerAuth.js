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
function targetUriFor(req) {
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return req.originalUrl;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${proto}://${host}${req.originalUrl}`;
}

function _parse(header, label) {
  if (!header) return null;
  const m = String(header).match(new RegExp(`${label}=:([^:]+):`));
  return m ? m[1] : null;
}

/**
 * True only for a request that carries a valid signature under `key`.
 *
 * Fails closed on every missing piece, and on an empty key: an unset
 * TARE_STRINGER_KEY must refuse everyone rather than admit whoever signs with
 * the empty string.
 */
function verifyStringerSignature(method, targetUri, body, headers, key) {
  if (!key) return false;

  const get = (n) => headers[n] ?? headers[n.toLowerCase()] ?? null;
  const signatureInput = get('signature-input');
  const signature = get('signature');
  const contentDigest = get('content-digest');
  if (!signatureInput || !signature || !contentDigest) return false;

  const expectedDigest =
    'sha-256=' + crypto.createHash('sha256').update(body ?? '').digest('base64');
  if (contentDigest !== expectedDigest) return false;

  const provided = _parse(signature, 'stringer');
  if (!provided) return false;

  const base = [
    `@method: ${String(method).toUpperCase()}`,
    `@target-uri: ${targetUri}`,
    `content-digest: ${contentDigest}`,
  ].join('\n');
  const expected = crypto.createHmac('sha256', key).update(base).digest('base64');

  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a length mismatch rather than returning false.
  const a = Buffer.from(expected, 'base64');
  const b = Buffer.from(provided, 'base64');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { targetUriFor, verifyStringerSignature };
