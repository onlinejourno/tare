'use strict';

// Characterization tests for server/dataFlow.js (auditDataFlow).
// Pins the cookie inventory, ID-sync detection, outbound-signal inference, and
// the deduped/severity-sorted data destinations for a Publication.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { auditDataFlow } = require('./dataFlow');

const SECONDS = () => Date.now() / 1000;
const fakePage = (cookies) => ({ context: () => ({ cookies: async () => cookies }) });

// _ga (first-party, tracking, persistent), IDE (third-party, tracking, persistent),
// sessid (first-party, session — neither tracking nor persistent).
const COOKIES = [
  { name: '_ga',    domain: 'example.com',      expires: SECONDS() + 400 * 86400 },
  { name: 'IDE',    domain: '.doubleclick.net', expires: SECONDS() + 30 * 86400  },
  { name: 'sessid', domain: 'example.com',      expires: 0 },
];

const REQUESTS = [
  { url: 'https://adnet.ad-exchange.com/usersync?uid=abcdef123' }, // id-sync + user_identifier
  { url: 'https://example.com/article' },                          // first-party, ignored
];

const TRACKERS = [
  { category: 'ssp',         name: 'PubMatic' },
  { category: 'ssp',         name: 'Magnite' },
  { category: 'analytics',   name: 'GA4' },
  { category: 'tag_manager', name: 'GTM' },
];

describe('auditDataFlow', () => {
  test('classifies cookies by party, tracking, and persistence', async () => {
    const r = await auditDataFlow(fakePage(COOKIES), [], [], 'example.com');
    assert.deepEqual(r.cookies, {
      total: 3, firstParty: 2, thirdParty: 1, tracking: 2, persistent: 2,
      longestCookie: { name: '_ga', domain: 'example.com', days: 400 },
    });
  });

  test('counts ID-sync requests and infers outbound signals from third-party URLs', async () => {
    const r = await auditDataFlow(fakePage([]), REQUESTS, [], 'example.com');
    assert.equal(r.idSyncCount, 1);
    assert.equal(r.outboundSignals.user_identifier, 1);
  });

  test('dedupes data destinations by category and sorts worst-first', async () => {
    const r = await auditDataFlow(fakePage([]), [], TRACKERS, 'example.com');
    assert.deepEqual(r.dataDestinations.map(d => d.category), ['ssp', 'analytics', 'tag_manager']);
    assert.deepEqual(r.dataDestinations[0].trackers, ['PubMatic', 'Magnite']);
  });

  test('reports the tag-manager chain (managers + everything they load)', async () => {
    const r = await auditDataFlow(fakePage([]), [], TRACKERS, 'example.com');
    assert.deepEqual(r.tagManagers, ['GTM']);
    assert.deepEqual(r.trackersBehind, ['PubMatic', 'Magnite', 'GA4']);
  });
});
