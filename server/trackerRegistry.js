'use strict';

// Tracker registry — the one place that knows how a request hostname maps to
// a known Tracker. The match rule (exact hostname OR any dot-boundary suffix:
// "sub.doubleclick.net" matches "doubleclick.net"; "evil-doubleclick.net.attacker.com"
// does not) previously lived inline in analyzer.js as O(trackers) scans per
// request. Lookups here walk the hostname's suffixes against prebuilt maps —
// O(labels) per request, and the semantics are testable in one place.
//
// Deliberate change vs the old scan: when the dataset contains both a parent
// key (facebook.com) and a more specific child (pixel.facebook.com), the
// registry returns the MOST SPECIFIC match. The old insertion-order scan let
// parent keys shadow child entries, making them unreachable dead data. The
// child entries carry identical category/severity (only more precise names),
// so scoring is unaffected.

const { TRACKERS, GOOGLE_DOMAINS } = require('./data/trackers');

const TRACKER_INDEX = new Map(Object.entries(TRACKERS));
const GOOGLE_INDEX  = new Set(GOOGLE_DOMAINS);

/** All dot-boundary suffixes of a hostname, longest first (including itself). */
function* _suffixes(hostname) {
  const labels = hostname.split('.');
  for (let i = 0; i < labels.length; i++) {
    yield labels.slice(i).join('.');
  }
}

/**
 * Look up a hostname against the known-Tracker dataset.
 * @param {string} hostname - request hostname (any case)
 * @returns {object|null} - { ...trackerInfo, hostname, matchedKey } or null
 */
function lookupTracker(hostname) {
  if (!hostname) return null;
  const h = hostname.toLowerCase();
  for (const suffix of _suffixes(h)) {
    const info = TRACKER_INDEX.get(suffix);
    if (info) return { ...info, hostname: h, matchedKey: suffix };
  }
  return null;
}

/** Is the hostname Google-owned (exact or dot-boundary suffix)? */
function isGoogleHostname(hostname) {
  if (!hostname) return false;
  for (const suffix of _suffixes(hostname.toLowerCase())) {
    if (GOOGLE_INDEX.has(suffix)) return true;
  }
  return false;
}

module.exports = { lookupTracker, isGoogleHostname };
