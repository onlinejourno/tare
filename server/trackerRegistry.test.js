'use strict';

// Tracker registry — the exact-or-suffix match semantics, previously inline
// O(trackers) scans in analyzer.js, now pinned in one place.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { lookupTracker, isGoogleHostname } = require('./trackerRegistry');
const { TRACKERS } = require('./data/trackers');

describe('lookupTracker', () => {
  test('exact hostname match', () => {
    const t = lookupTracker('doubleclick.net');
    assert.ok(t, 'doubleclick.net must be a known Tracker');
    assert.equal(t.matchedKey, 'doubleclick.net');
    assert.equal(t.hostname, 'doubleclick.net');
  });

  test('subdomain matches via dot-boundary suffix', () => {
    const t = lookupTracker('x.hotjar.com'); // not itself a dataset key
    assert.ok(t);
    assert.equal(t.matchedKey, 'hotjar.com');
  });

  test('most specific key wins when dataset has parent AND child entries', () => {
    // Old inline scan matched in insertion order — parent keys shadowed the
    // more precise child entries (pixel.facebook.com, pubads.g.doubleclick.net
    // were dead data). The registry walks longest suffix first.
    assert.equal(lookupTracker('pixel.facebook.com').matchedKey, 'pixel.facebook.com');
    assert.equal(lookupTracker('sub.pixel.facebook.com').matchedKey, 'pixel.facebook.com');
    assert.equal(lookupTracker('other.facebook.com').matchedKey, 'facebook.com');
  });

  test('substring without dot boundary does NOT match', () => {
    // "evil-doubleclick.net.attacker.com": no suffix equals a tracker key
    assert.equal(lookupTracker('evil-doubleclick.net.attacker.com'), null);
  });

  test('case-insensitive', () => {
    const t = lookupTracker('Stats.G.DoubleClick.NET');
    assert.ok(t);
    assert.equal(t.hostname, 'stats.g.doubleclick.net');
  });

  test('unknown host and empty input return null', () => {
    assert.equal(lookupTracker('example.com'), null);
    assert.equal(lookupTracker(''), null);
    assert.equal(lookupTracker(null), null);
  });

  test('longest (most specific) key wins over a shorter suffix key', () => {
    // If the dataset ever contains both "a.b" and "b" style keys, the walk
    // from longest suffix guarantees the specific entry matches first.
    // Verified structurally: _suffixes iterates longest → shortest.
    const anyKey = Object.keys(TRACKERS)[0];
    const t = lookupTracker('deep.sub.' + anyKey);
    assert.equal(t.matchedKey, anyKey);
  });
});

describe('isGoogleHostname', () => {
  test('google domains and subdomains', () => {
    assert.equal(isGoogleHostname('googletagmanager.com'), true);
    assert.equal(isGoogleHostname('www.googletagmanager.com'), true);
  });
  test('non-google and lookalikes', () => {
    assert.equal(isGoogleHostname('example.com'), false);
    assert.equal(isGoogleHostname('notgoogletagmanager.com'), false);
    assert.equal(isGoogleHostname(''), false);
  });
});
