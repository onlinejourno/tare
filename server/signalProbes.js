'use strict';

// Signal Probes — the server-side plain-HTTP layer of signal detection
// (CONTEXT.md: "Signal Probe"). Owns the SSRF-guarded fetch sink, the three
// probe functions (RSS, editorial, article), their scheduling (with the
// path-depth gate for the Article Signal Probe), and the upgrade-only merge
// of probe results into DOM signals. Both Analysis modes go through this
// module; the "layers only upgrade, never downgrade" invariant lives here.
const https = require('https');
const http  = require('http');
const { isPrivateHostname, guardedLookup } = require('./ssrfGuard');

// ── RSS HTTP probe (runs server-side, bypasses Cloudflare JS challenge) ────────
// Tries common feed paths via plain HTTP GET — no headless browser needed.
// Falls back to fetching a feed-index page and scanning its links.

const RSS_DIRECT_PATHS = [
  '/feed', '/feed/', '/rss', '/rss/', '/rss.xml', '/atom.xml', '/feed.xml',
  '/feeds/all.rss', '/feeder/default.rss', '/rssfeeds/default.rss',
  '/news/rss.xml', '/feeds/rss.xml',
];
const RSS_INDEX_PATHS  = ['/rssfeeds/', '/feeds/', '/rss/', '/rss-feeds/'];
const RSS_LINK_RE      = /href=["'][^"']*(?:\.rss|\.xml|\/feeder\/|\/feed\/|\/rssfeeds\/)[^"']*/i;
// Two UAs: crawler UA for institutional paths (allows publisher allowlisting),
// Chrome UA for article fetches (passes Cloudflare WAF static HTML serving).
const PROBE_UA        = 'DemocraticInfrastructureChecker/1.0 (+https://digitalmirror.info/checker)';
const CHROME_UA       = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function _fetch(url, readBody, ua = PROBE_UA, maxBytes = 30000) {
  return new Promise((resolve) => {
    const empty = { status: 0, ct: '', body: '', location: '' };
    // SSRF guard at the sink: every probe URL (user-derived hostname, redirect
    // target, feed path) is re-checked here — http(s) only, no private hosts,
    // and guardedLookup blocks DNS rebinding at connect time.
    let parsed;
    try { parsed = new URL(url); } catch { return resolve(empty); }
    if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateHostname(parsed.hostname)) {
      return resolve(empty);
    }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, { lookup: guardedLookup, headers: { 'User-Agent': ua, 'Accept': 'text/html,application/xhtml+xml' }, timeout: 8000 }, (res) => {
      const status   = res.statusCode || 0;
      const ct       = res.headers['content-type'] || '';
      const location = res.headers['location'] || '';
      if (!readBody || status !== 200) { res.destroy(); return resolve({ status, ct, body: '', location }); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; if (body.length > maxBytes) res.destroy(); });
      res.on('close', () => resolve({ status, ct, body, location }));
      res.on('end',   () => resolve({ status, ct, body, location }));
    });
    req.on('error',   () => resolve({ status: 0, ct: '', body: '', location: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ct: '', body: '', location: '' }); });
  });
}

const SOFT_404_PHRASES = ['page not found', 'not found', "doesn't exist", 'does not exist', 'error 404'];

async function _fetchInstitutional(url) {
  // Fetch with small body read to verify content, follow one redirect level.
  const r1 = await _fetch(url, true, PROBE_UA, 2000);
  let status = r1.status; let body = r1.body;
  if ((status === 301 || status === 302) && r1.location) {
    try {
      const dest = r1.location.startsWith('http') ? r1.location : new URL(r1.location, url).href;
      if (isPrivateHostname(new URL(dest).hostname)) return false;  // SSRF: no redirect to internal
      const r2 = await _fetch(dest, true, PROBE_UA, 2000);
      status = r2.status; body = r2.body;
    } catch { return false; }
  }
  if (status !== 200) return false;
  if (body.length < 500) return false;
  const lower = body.toLowerCase();
  return !SOFT_404_PHRASES.some(p => lower.includes(p));
}

async function probeRssFeeds(hostname) {
  const base = `https://${hostname}`;

  // 1. Direct feed paths — look for XML content-type
  for (const path of RSS_DIRECT_PATHS) {
    const { status, ct } = await _fetch(base + path, false);
    if (status === 200 && (ct.includes('xml') || ct.includes('rss') || ct.includes('atom'))) {
      return { found: true, url: base + path };
    }
  }

  // 2. Feed index pages — fetch HTML and scan for RSS link hrefs
  for (const path of RSS_INDEX_PATHS) {
    const { status, body } = await _fetch(base + path, true);
    if (status === 200 && RSS_LINK_RE.test(body)) {
      return { found: true, url: base + path };
    }
  }

  return { found: false };
}

// ── Article-level static HTML probe ──────────────────────────────────────────
// Fetches the specific article URL via plain HTTP with a real Chrome UA.
// Cloudflare passes plain HTTP requests when the headless browser is blocked.
// Extracts bylines, corrections links, and other participation signals from
// static HTML — more reliable than waiting for JS to hydrate the DOM.

const ARTICLE_BYLINE_RE = /class="[^"]*(?:author-name|author_name|byline|auth-nm|author-wrap)[^"]*"[^>]*>([\s\S]{1,400}?)(?=<div\s|<section\s|<\/article)/i;
const CORRECTIONS_HREF_RE = /href="[^"]*(?:correction|errata|clarification)[^"]*"/i;
const CONTACT_HREF_RE     = /href="[^"]*(?:\/contact|\/letters|\/reach-us|\/write-to-us)[^"]*"/i;

async function probeArticleSignals(articleUrl) {
  const result = { hasBylines: false, hasCorrections: false, hasContact: false };
  try {
    const { status, body } = await _fetch(articleUrl, true, PROBE_UA, 200_000);
    if (status !== 200 || body.length < 500) return result;

    // Skip Cloudflare challenge pages
    if (body.includes('Just a moment') || body.includes('cf-browser-verification')) return result;

    // Bylines: find author-name/byline div and strip inner tags
    const bylineMatch = ARTICLE_BYLINE_RE.exec(body);
    if (bylineMatch) {
      const text = bylineMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      result.hasBylines = text.length > 1;
    }

    // Corrections and contact links anywhere in the page
    result.hasCorrections = CORRECTIONS_HREF_RE.test(body);
    result.hasContact     = CONTACT_HREF_RE.test(body);
  } catch {}
  return result;
}

// ── Editorial signals probe (plain HTTP — bypasses JS challenges) ─────────────
// Checks well-known institutional URL paths for About, Editorial Policy,
// Corrections, and Contact pages. Returns boolean per signal.

const EDITORIAL_PROBE_PATHS = {
  about:      ['/about/', '/aboutus/', '/about-us/', '/about', '/who-we-are/',
               '/about/us/', '/company/', '/our-story/'],
  editorial:  ['/values/', '/ethics/', '/editorial/', '/editorial-policy/',
               '/editorial-standards/', '/editorial-code/', '/our-journalism/',
               '/editorial-values/', '/code-of-conduct/'],
  corrections:['/corrections/', '/corrections-clarifications/',
               '/errata/', '/corrections-and-clarifications/',
               '/editorial-corrections/'],
  contact:    ['/contact/', '/contact-us/', '/reach-us/', '/letters/',
               '/reader-mail/', '/feedback/', '/write-to-us/'],
};

async function probeEditorialSignals(hostname) {
  const base    = `https://${hostname}`;
  const result  = { about: false, editorial: false, corrections: false, contact: false };

  await Promise.all(
    Object.entries(EDITORIAL_PROBE_PATHS).map(async ([key, paths]) => {
      for (const path of paths) {
        // _fetchInstitutional follows one redirect and rejects soft 404s
        const ok = await _fetchInstitutional(base + path);
        if (ok) { result[key] = true; return; }
      }
    })
  );

  return result;
}

// ── Scheduling + merge (shared by both Analysis modes) ────────────────────────

/**
 * Start all three Signal Probes for one Publication URL. Fire-and-forget
 * friendly: call before browser navigation, await after — the probes run in
 * parallel with whatever else the caller does.
 *
 * The Article Signal Probe only runs on deep URLs (path depth ≥ 2) — homepage
 * and section-front URLs have no bylines, so the 200 KB fetch adds nothing.
 *
 * @param {string} url - full Publication URL (already SSRF-validated by caller;
 *   _fetch re-checks at the sink as defence-in-depth)
 * @returns {Promise<{rss: object, editorial: object, article: object}>}
 */
function startSignalProbes(url) {
  let hostname = null, pathDepth = 0;
  try {
    const parsed = new URL(url);
    hostname  = parsed.hostname;
    pathDepth = parsed.pathname.split('/').filter(Boolean).length;
  } catch {}

  if (!hostname) {
    return Promise.resolve({
      rss:      { found: false },
      editorial: { about: false, editorial: false, corrections: false, contact: false },
      article:  { hasBylines: false, hasCorrections: false, hasContact: false },
    });
  }

  const article = pathDepth >= 2
    ? probeArticleSignals(url)
    : Promise.resolve({ hasBylines: false, hasCorrections: false, hasContact: false });

  return Promise.all([probeRssFeeds(hostname), probeEditorialSignals(hostname), article])
    .then(([rss, editorial, art]) => ({ rss, editorial, article: art }));
}

/**
 * Merge Signal Probe results into DOM signals — upgrade-only, never downgrade
 * (CONTEXT.md invariant: if the DOM found a signal, a probe cannot un-find it).
 * Mutates and returns `domData`. Absent/failed probes are no-ops.
 */
function upgradeDomSignals(domData, { rss, editorial, article } = {}) {
  if (rss?.found              && !domData.hasRss)             domData.hasRss             = true;
  if (editorial?.about        && !domData.hasAbout)           domData.hasAbout           = true;
  if (editorial?.editorial    && !domData.hasEditorialPolicy) domData.hasEditorialPolicy = true;
  if (editorial?.corrections  && !domData.hasCorrections)     domData.hasCorrections     = true;
  if (editorial?.contact      && !domData.hasContact)         domData.hasContact         = true;
  if (article?.hasBylines     && !domData.hasBylines)         domData.hasBylines         = true;
  if (article?.hasCorrections && !domData.hasCorrections)     domData.hasCorrections     = true;
  if (article?.hasContact     && !domData.hasContact)         domData.hasContact         = true;
  return domData;
}

module.exports = {
  probeRssFeeds,
  probeEditorialSignals,
  probeArticleSignals,
  startSignalProbes,
  upgradeDomSignals,
};
