'use strict';

// SSRF guard — shared by the API boundary (validateUrl, with DNS resolution)
// and the in-browser / redirect defence (isPrivateHostname, synchronous string
// check on every request the headless browser or a probe redirect tries to make).

const dns = require('dns').promises;
const dnsCb = require('dns');
const ipaddr = require('ipaddr.js');

const PRIVATE_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^::$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,                                   // link-local + cloud metadata
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,      // CGNAT 100.64.0.0/10 (full range)
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,                              // ULA fc00::/7
  /^fe80:/i,                                       // link-local
  /^::ffff:(127|10|0|192\.168|169\.254)\./i,       // IPv4-mapped IPv6
];

/**
 * Synchronous hostname/IP string check — used per-request inside the browser
 * and on every redirect target. Node skips the custom `guardedLookup` for
 * IP-literal hosts (it connects directly), so for literals this string check is
 * the ONLY defence. The regex list alone missed IPv6 forms that `new URL()`
 * serialises to hex — e.g. `[::ffff:169.254.169.254]` becomes `::ffff:a9fe:a9fe`,
 * which slipped straight through to the cloud metadata endpoint. Parse IP
 * literals with ipaddr.js and reject any non-`unicast` range; keep the legacy
 * patterns as defence-in-depth for non-IP hostnames and parser edge cases.
 */
function isPrivateHostname(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (/^localhost$/.test(h) || h.endsWith('.localhost') || h.endsWith('.internal')) {
    return true;
  }
  if (ipaddr.isValid(h)) {
    let addr = ipaddr.parse(h);
    // Decode IPv4-mapped IPv6 (::ffff:x.x.x.x) to its embedded IPv4 so the
    // range check sees the real target rather than the opaque 'ipv4Mapped' range.
    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
      addr = addr.toIPv4Address();
    }
    // 'unicast' is the only publicly-routable range; everything else
    // (loopback, private, linkLocal, uniqueLocal, carrierGradeNat,
    // unspecified, reserved, multicast, …) is off-limits.
    if (addr.range() !== 'unicast') return true;
  }
  return PRIVATE_PATTERNS.some((p) => p.test(h));
}

/**
 * Validate a user-supplied URL is a safe public http(s) target.
 * Rejects non-http(s) schemes and resolves *all* addresses the host maps to
 * (DNS-rebinding / multi-record aware). Returns the normalised href.
 */
async function validateUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid URL — could not parse.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http:// and https:// URLs are supported.');
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error('Private/local network URLs are not allowed.');
  }
  let addrs;
  try {
    addrs = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw new Error('Could not resolve hostname.');
  }
  for (const { address } of addrs) {
    if (isPrivateHostname(address)) {
      throw new Error('Private/local network URLs are not allowed.');
    }
  }
  return parsed.href;
}

/**
 * DNS lookup for http(s) request options that refuses to resolve to a private
 * address. Passing this as `{ lookup: guardedLookup }` blocks DNS rebinding at
 * connect time: even if a hostname passed validation earlier and its record
 * changed since, the socket can never reach a private/link-local/metadata IP.
 */
function guardedLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  dnsCb.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const addrs = Array.isArray(addresses) ? addresses : [addresses];
    for (const a of addrs) {
      if (isPrivateHostname(a.address)) {
        return callback(new Error('Blocked: hostname resolves to a private address.'));
      }
    }
    if (options.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
}

module.exports = { PRIVATE_PATTERNS, isPrivateHostname, validateUrl, guardedLookup };
