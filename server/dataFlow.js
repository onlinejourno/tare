'use strict';

// ── Cookie name patterns that indicate tracking ───────────────────────────────
const TRACKING_COOKIE_PATTERNS = [
  '_ga', '_gid', '_gat',           // Google Analytics
  '_fbp', '_fbc',                   // Facebook/Meta
  '__utma', '__utmb', '__utmc', '__utmz', // GA classic
  'AMCV_', 'AMCVS_', 'demdex',     // Adobe
  's_vi', 's_fid',                  // Adobe Analytics
  'IDE', 'DSID',                    // DoubleClick/Google Ads
  'uuid2', 'anj',                   // AppNexus/Xandr
  'MUID',                           // Microsoft
  'cto_bundle', 'cto_lwid',        // Criteo
  'obuid',                          // Outbrain
  'trc_',                           // Taboola
  'visitor_id', 'vid', 'uid',      // generic tracker IDs
  'cbuid', 'permutive-',            // Permutive
  'stx_user_id',                   // Sharethrough
];

// ── URL patterns that indicate cross-site identity synchronisation ────────────
const ID_SYNC_PATTERNS = [
  'idsync', 'id_sync', 'usersync', 'user_sync', 'cookie_sync', 'synced',
  'cm.g.doubleclick', 'match.adsrvr', 'dis.criteo',
  'pixel.advertising.com', 'sync.crwdcntrl.net',
  'id5-sync', 'liveramp', 'sharedid',
  'cm?gdpr', 'cm?us_privacy',
];

// ── Data types that can be inferred from outbound URL parameters ──────────────
const OUTBOUND_SIGNAL_PATTERNS = [
  { regex: /[?&](uid|uuid|user_id|userId|visitor_id|vid|cid|client_id)=[^&]{6,}/i, type: 'user_identifier' },
  { regex: /[?&](email|em|hashed_email)=[^&]{4,}/i,                               type: 'email' },
  { regex: /[?&](url|page_url|document_location|dl)=https?/i,                     type: 'page_url' },
  { regex: /[?&](ref|referrer|dr|document_referrer)=[^&]{4,}/i,                   type: 'referrer' },
  { regex: /[?&](ua|user_agent)=[^&]{8,}/i,                                        type: 'device_info' },
  { regex: /[?&](lat|lon|latitude|longitude)=[^&]{2,}/i,                           type: 'location' },
];

// ── What each tracker category receives from readers ─────────────────────────
const CATEGORY_DATA_RECEIVED = {
  fingerprinting:       { label: 'Session Recording',        icon: '🖱️',  receives: ['Every mouse movement', 'Scroll depth', 'Keystrokes', 'Form fills (inc. passwords)'] },
  identity_resolution:  { label: 'Identity Graph',           icon: '🕸️',  receives: ['Cross-device IDs', 'Email hashes', 'Browser fingerprint', 'Purchase history'] },
  data_broker:          { label: 'Data Broker',              icon: '🗄️',  receives: ['Browsing history', 'Purchase intent', 'Demographic inferences', 'Offline-online linkage'] },
  social_pixel:         { label: 'Social Platform Pixel',    icon: '👁️',  receives: ['Page visits', 'Reader identity match', 'Event data', 'Content category'] },
  ssp:                  { label: 'Ad Auction (SSP)',          icon: '⚡',  receives: ['Reader identity', 'Page context', 'Bid request with full profile', 'Device & location signals'] },
  advertising:          { label: 'Advertising / Retargeting', icon: '🎯', receives: ['Reader profile', 'Behavioural segments', 'Cross-site history', 'Purchase intent'] },
  editorial_ai:         { label: 'AI Editorial / Paywall',   icon: '🤖',  receives: ['Reading history', 'Engagement score', 'Scroll patterns', 'Subscription propensity'] },
  analytics:            { label: 'Analytics',                icon: '📊',  receives: ['Page views', 'Session data', 'Device & OS', 'Referral source'] },
  editorial_analytics:  { label: 'Editorial Analytics',      icon: '📰',  receives: ['Article engagement', 'Scroll depth', 'Time on page', 'Content popularity'] },
  audience_measurement: { label: 'Audience Measurement',     icon: '📏',  receives: ['Demographics', 'Reach data', 'Panel reporting', 'Cross-publisher audience'] },
  ab_testing:           { label: 'A/B & Personalisation',   icon: '🧪',  receives: ['User segment', 'Variant assignment', 'Conversion events', 'Session context'] },
  tag_manager:          { label: 'Tag Manager',              icon: '🏷️',  receives: ['All page data — orchestrates loading of every other tracker'] },
};

// Severity order (worst first) for sorting destinations
const SEVERITY_ORDER = [
  'fingerprinting', 'identity_resolution', 'data_broker', 'social_pixel',
  'ssp', 'advertising', 'editorial_ai', 'analytics', 'editorial_analytics',
  'audience_measurement', 'ab_testing', 'tag_manager',
];

function getHostname(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function isTrackingCookie(name) {
  const n = name.toLowerCase();
  return TRACKING_COOKIE_PATTERNS.some(p => n.startsWith(p.toLowerCase()));
}

function isPersistentCookie(cookie) {
  if (!cookie.expires || cookie.expires <= 0) return false;
  return (cookie.expires - Date.now() / 1000) > 86400; // > 24 h
}

// ── Main export ───────────────────────────────────────────────────────────────

async function auditDataFlow(page, allRequests, trackers, pageHostname) {
  const pageHost = pageHostname.replace(/^www\./, '');

  // ── 1. Cookie inventory ───────────────────────────────────────────────────
  let cookies = [];
  try { cookies = await page.context().cookies(); } catch {}

  const firstPartyCookies  = cookies.filter(c => {
    const d = (c.domain || '').replace(/^\./, '');
    return d === pageHost || d.endsWith('.' + pageHost);
  });
  const thirdPartyCookies  = cookies.filter(c => {
    const d = (c.domain || '').replace(/^\./, '');
    return d !== pageHost && !d.endsWith('.' + pageHost);
  });
  const trackingCookies    = cookies.filter(c => isTrackingCookie(c.name));
  const persistentCookies  = cookies.filter(isPersistentCookie);

  // Longest-lived cookie (a signal of long-term surveillance intent)
  let longestCookie = null;
  for (const c of persistentCookies) {
    const days = Math.round((c.expires - Date.now() / 1000) / 86400);
    if (!longestCookie || days > longestCookie.days) {
      longestCookie = { name: c.name, domain: c.domain, days };
    }
  }

  // ── 2. ID synchronisation ─────────────────────────────────────────────────
  const thirdPartyUrls = allRequests
    .filter(r => {
      const h = getHostname(r.url);
      return h && h !== pageHost && !h.endsWith('.' + pageHost);
    })
    .map(r => r.url.toLowerCase());

  const idSyncUrls  = thirdPartyUrls.filter(url =>
    ID_SYNC_PATTERNS.some(p => url.includes(p))
  );

  // ── 3. Outbound data signals ──────────────────────────────────────────────
  const outboundSignals = {};
  for (const url of thirdPartyUrls) {
    for (const { regex, type } of OUTBOUND_SIGNAL_PATTERNS) {
      if (regex.test(url)) outboundSignals[type] = (outboundSignals[type] || 0) + 1;
    }
  }

  // ── 4. Data destinations (what each tracker category receives) ────────────
  const seenCategories = new Set();
  const dataDestinations = [];

  for (const tracker of trackers) {
    if (seenCategories.has(tracker.category)) continue;
    seenCategories.add(tracker.category);
    const meta = CATEGORY_DATA_RECEIVED[tracker.category];
    if (!meta) continue;
    const inCategory = trackers.filter(t => t.category === tracker.category);
    dataDestinations.push({
      category: tracker.category,
      label:    meta.label,
      icon:     meta.icon,
      receives: meta.receives,
      trackers: inCategory.map(t => t.name),
    });
  }

  dataDestinations.sort((a, b) => {
    const ai = SEVERITY_ORDER.indexOf(a.category);
    const bi = SEVERITY_ORDER.indexOf(b.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // ── 5. Tag manager chain ──────────────────────────────────────────────────
  const tagManagers    = trackers.filter(t => t.category === 'tag_manager').map(t => t.name);
  const trackersBehind = tagManagers.length > 0
    ? trackers.filter(t => t.category !== 'tag_manager').map(t => t.name)
    : [];

  return {
    cookies: {
      total:        cookies.length,
      firstParty:   firstPartyCookies.length,
      thirdParty:   thirdPartyCookies.length,
      tracking:     trackingCookies.length,
      persistent:   persistentCookies.length,
      longestCookie,
    },
    idSyncCount:     idSyncUrls.length,
    outboundSignals,
    dataDestinations,
    tagManagers,
    trackersBehind,
  };
}

module.exports = { auditDataFlow };
