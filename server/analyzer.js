'use strict';

const { chromium, errors: pwErrors } = require('playwright');
const { isPrivateHostname } = require('./ssrfGuard');
const { TRACKERS, GOOGLE_DOMAINS, CATEGORY_META } = require('./data/trackers');
const { detectDarkPatterns, detectAdBlockerWall } = require('./darkPatterns');
const { analyzeOpenness, probeRssFeeds, probeEditorialSignals, probeArticleSignals } = require('./openness');
const { auditDataFlow } = require('./dataFlow');
const { auditPaywall } = require('./paywallAudit');

const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_WAIT_MS        = 4_000;
const BODY_READ_SIZE_LIMIT  = 5 * 1024 * 1024;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getHostname(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function detectTracker(requestUrl) {
  const hostname = getHostname(requestUrl);
  if (!hostname) return null;
  for (const [key, info] of Object.entries(TRACKERS)) {
    if (hostname === key || hostname.endsWith('.' + key)) {
      return { ...info, hostname, matchedKey: key };
    }
  }
  return null;
}

function isThirdParty(requestUrl, pageHostname) {
  const reqHost  = getHostname(requestUrl).replace(/^www\./, '');
  const pageHost = pageHostname.replace(/^www\./, '');
  return reqHost !== '' && reqHost !== pageHost && !reqHost.endsWith('.' + pageHost);
}

function isGoogleDomain(requestUrl) {
  const hostname = getHostname(requestUrl);
  return GOOGLE_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
}

function computeCoverage(entry) {
  const total = entry.text ? entry.text.length : 0;
  const used  = (entry.ranges || []).reduce((sum, r) => sum + (r.end - r.start), 0);
  return {
    url:           entry.url,
    totalBytes:    total,
    usedBytes:     used,
    unusedBytes:   total - used,
    unusedPercent: total > 0 ? Math.round(((total - used) / total) * 100) : 0,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function groupByType(requests) {
  const groups = {};
  for (const req of requests) {
    const t = req.resourceType || 'other';
    if (!groups[t]) groups[t] = { count: 0, bytes: 0 };
    groups[t].count++;
    groups[t].bytes += req.transferBytes;
  }
  return groups;
}

// ── Consent timing ───────────────────────────────────────────────────────────
// Measures whether any third-party request fires before the consent banner
// renders — a structural GDPR violation common across news publishers.

const CMP_SELECTORS = [
  '#onetrust-banner-sdk', '.onetrust-pc-dark-filter',
  '#CybotCookiebotDialog', '#qc-cmp2-ui', '#truste-consent-track',
  '[id*="cookie-banner"]', '[id*="consent-banner"]',
  '[class*="cookie-consent"]', '[class*="cookieBanner"]',
  '[id*="cookie_consent"]', '[class*="gdpr"]', '[id*="gdpr"]',
  '.cc-banner', '#usercentrics-root', '[id*="didomi"]',
  '.sp_choice_type_11', '#_evidon_banner',
];

async function measureConsentTiming(page, thirdPartyRequestTimes) {
  let cmpSelector = null;
  for (const selector of CMP_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el) { cmpSelector = selector; break; }
    } catch {}
  }

  const firstThirdPartyMs = thirdPartyRequestTimes.length > 0
    ? Math.min(...thirdPartyRequestTimes) : null;

  // Estimate banner render at ~80% of request timeline
  const pageLoadMs        = thirdPartyRequestTimes.length > 0
    ? Math.max(...thirdPartyRequestTimes) : null;
  const estimatedBannerMs = pageLoadMs ? pageLoadMs * 0.8 : null;

  const preConsentFires   = estimatedBannerMs !== null
    ? thirdPartyRequestTimes.filter(t => t < estimatedBannerMs).length : 0;

  return {
    consentBannerDetected:     cmpSelector !== null,
    cmpSelector,
    firstThirdPartyRequestMs:  firstThirdPartyMs,
    estimatedBannerMs,
    preConsentThirdPartyCount: preConsentFires,
    trackersFireBeforeConsent: preConsentFires > 0 && cmpSelector !== null,
  };
}

// ── Performance metrics ──────────────────────────────────────────────────────

async function collectPerformanceMetrics(page) {
  try {
    return await page.evaluate(() => {
      const nav        = performance.getEntriesByType('navigation')[0] || {};
      const paint      = performance.getEntriesByType('paint');
      const fcp        = paint.find(p => p.name === 'first-contentful-paint');
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      const lcp        = lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1] : null;
      const longTasks  = performance.getEntriesByType('longtask');
      const tbt        = longTasks.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);
      return {
        ttfb:             nav.responseStart     ? Math.round(nav.responseStart - nav.requestStart) : null,
        domContentLoaded: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd - nav.requestStart) : null,
        pageLoad:         nav.loadEventEnd      ? Math.round(nav.loadEventEnd - nav.requestStart) : null,
        fcp:              fcp ? Math.round(fcp.startTime) : null,
        lcp:              lcp ? Math.round(lcp.startTime) : null,
        tbt:              Math.round(tbt),
      };
    });
  } catch {
    return { ttfb: null, domContentLoaded: null, pageLoad: null, fcp: null, lcp: null, tbt: 0 };
  }
}

// ── Google ecosystem attribution ─────────────────────────────────────────────

function buildGoogleAttribution(allRequests) {
  const googleRequests = allRequests.filter(r => isGoogleDomain(r.url));
  const totalBytes     = allRequests.reduce((s, r) => s + r.transferBytes, 0);
  const googleBytes    = googleRequests.reduce((s, r) => s + r.transferBytes, 0);

  const products = new Set();
  for (const req of googleRequests) {
    const h = getHostname(req.url);
    if (h.includes('googletagmanager'))                                                       products.add('Google Tag Manager');
    if (h.includes('google-analytics') || (h.includes('analytics') && h.includes('google'))) products.add('Google Analytics');
    if (h.includes('doubleclick') || h.includes('googlesyndication') || h.includes('googleadservices') || h.includes('adservice')) products.add('Google Ad Manager / AdSense');
    if (h.includes('fonts.googleapis') || h.includes('fonts.gstatic'))                       products.add('Google Fonts');
    if (h.includes('ajax.googleapis') || h.includes('apis.google'))                          products.add('Google APIs / CDN');
    if (h.includes('maps.googleapis') || h.includes('maps.gstatic'))                         products.add('Google Maps');
    if (h.includes('youtube') || h.includes('ytimg') || h.includes('googlevideo'))           products.add('YouTube Embed');
    if (h.includes('googletagservices'))                                                      products.add('Google Tag Services');
  }

  return {
    requestCount:   googleRequests.length,
    totalRequests:  allRequests.length,
    requestPercent: allRequests.length > 0 ? Math.round((googleRequests.length / allRequests.length) * 100) : 0,
    bytes:          googleBytes,
    totalBytes,
    bytesPercent:   totalBytes > 0 ? Math.round((googleBytes / totalBytes) * 100) : 0,
    products:       [...products],
    // The double-bind: Google's ad tech requires these scripts, while Google's
    // Core Web Vitals penalises the resulting page slowness.
    isDoubleBind:   products.has('Google Ad Manager / AdSense') && products.has('Google Tag Manager'),
  };
}

// ── RTB cascade ──────────────────────────────────────────────────────────────

function buildRtbCascade(allRequests) {
  const rtbRequests = allRequests
    .reduce((acc, r) => {
      const tracker = detectTracker(r.url);
      if (tracker && tracker.isRTB) {
        acc.push({
          url:      r.url,
          hostname: getHostname(r.url),
          name:     tracker.name,
          category: tracker.category,
          startMs:  r.startMs || null,
          bytes:    r.transferBytes,
        });
      }
      return acc;
    }, [])
    .sort((a, b) => (a.startMs || 0) - (b.startMs || 0));

  const sspHostnames  = new Set(rtbRequests.filter(r => r.category === 'ssp').map(r => r.hostname));
  const uniqueNames   = [...new Map(rtbRequests.map(r => [r.hostname, r.name])).values()];

  return {
    count:                 rtbRequests.length,
    uniqueParticipants:    uniqueNames.length,
    participantNames:      uniqueNames,
    requests:              rtbRequests,
    headerBiddingDetected: sspHostnames.size >= 3,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function analyzeUrl(url, emitProgress) {
  const startTime    = Date.now();
  const pageHostname = getHostname(url);

  emitProgress('launching_browser', 5);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // SSRF defence-in-depth: abort any request (redirect target, sub-resource,
    // late XHR) to a private/link-local host that slipped past entry validation.
    await context.route('**', (route) => {
      if (isPrivateHostname(getHostname(route.request().url()))) return route.abort();
      return route.continue();
    });

    const requestMap             = new Map();
    const responseMap            = new Map();
    const requestTimings         = new Map();
    const thirdPartyRequestTimes = [];
    let   navigationStartMs      = 0; // set to Date.now() immediately before page.goto

    page.on('request', (req) => {
      const nowMs = Date.now() - navigationStartMs;
      requestMap.set(req.url(), { url: req.url(), method: req.method(), resourceType: req.resourceType(), startMs: nowMs });
      if (isThirdParty(req.url(), pageHostname)) thirdPartyRequestTimes.push(nowMs);
      requestTimings.set(req.url(), nowMs);
    });

    page.on('response', async (res) => {
      const reqUrl = res.url();
      try {
        const headers      = res.headers();
        const contentType  = headers['content-type'] || '';
        const clHeader     = parseInt(headers['content-length'] || '0', 10);
        let bodySize       = clHeader;
        const resourceType = requestMap.get(reqUrl)?.resourceType;
        if ((resourceType === 'script' || resourceType === 'stylesheet') && res.status() < 300) {
          // Skip body read only when content-length explicitly reports oversized file.
          // clHeader=0 means header absent (unknown size) — still attempt read.
          const tooLarge = clHeader > 0 && clHeader >= BODY_READ_SIZE_LIMIT;
          if (!tooLarge) {
            try { bodySize = (await res.body()).length; } catch {}
          }
        }
        responseMap.set(reqUrl, { status: res.status(), contentType, transferBytes: bodySize });
      } catch {}
    });

    emitProgress('starting_coverage', 10);
    await Promise.all([
      page.coverage.startJSCoverage({ resetOnNavigation: false }),
      page.coverage.startCSSCoverage({ resetOnNavigation: false }),
    ]);

    // All three probes fire via plain HTTP in parallel with browser navigation —
    // bypasses Cloudflare/WAF JS challenges that block the headless browser.
    const rssProbePromise      = probeRssFeeds(pageHostname);
    const editorialProbePromise = probeEditorialSignals(pageHostname);
    // Article Signal Probe only runs on deep URLs (path depth ≥ 2) — homepage
    // and section-front URLs have no bylines, so the 200 KB fetch adds nothing.
    const urlPathDepth = (() => {
      try { return new URL(url).pathname.split('/').filter(Boolean).length; } catch { return 0; }
    })();
    const articleProbePromise = urlPathDepth >= 2
      ? probeArticleSignals(url)
      : Promise.resolve({ hasBylines: false, hasCorrections: false, hasContact: false });

    emitProgress('navigating', 15);
    navigationStartMs = Date.now();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (err) {
      // Navigation timeout is acceptable — page is partially loaded; continue analysis.
      // Any other error (net::ERR_NAME_NOT_RESOLVED etc.) is a real failure.
      if (!(err instanceof pwErrors.TimeoutError)) throw err;
    }
    await page.waitForTimeout(SETTLE_WAIT_MS);
    // Heavy publishers (e.g. The Hindu) load Piano/GTM asynchronously after networkidle.
    // If their globals are present but requests are still in-flight, give an extra settle.
    try {
      const lateLoading = await page.evaluate(() =>
        typeof window.tp !== 'undefined' ||
        typeof window.googletag !== 'undefined' ||
        typeof window.cX !== 'undefined'
      );
      if (lateLoading) await page.waitForTimeout(2_500);
    } catch {}


    // ── Bot-protection detection ──────────────────────────────────────────────
    // Cloudflare (and similar) serve a JS challenge page to headless browsers.
    // When blocked, scores are based on near-empty content — false Reader-Respecting
    // scores. Detect and flag so the UI can warn the user.
    let accessBlocked = null;
    try {
      accessBlocked = await page.evaluate(() => {
        const title    = document.title || '';
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
        const isCfChallenge = title.includes('Just a moment') || bodyText.includes('performing security verification') || bodyText.includes('ray id:');
        const isGenericBlock = wordCount < 100 && (bodyText.includes('access denied') || bodyText.includes('403 forbidden') || bodyText.includes('enable javascript'));
        if (isCfChallenge) return { blocked: true, type: 'cloudflare', title };
        if (isGenericBlock) return { blocked: true, type: 'generic', title };
        return { blocked: false };
      });
    } catch {}

    emitProgress('auditing_consent', 50);
    const consentAudit = await measureConsentTiming(page, thirdPartyRequestTimes);

    emitProgress('collecting_performance', 55);
    const performanceMetrics = await collectPerformanceMetrics(page);

    emitProgress('collecting_coverage', 60);
    const [jsCoverageEntries, cssCoverageEntries] = await Promise.all([
      page.coverage.stopJSCoverage(),
      page.coverage.stopCSSCoverage(),
    ]);

    emitProgress('analyzing_assets', 72);
    const imageData = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(img => ({
        src:           img.src,
        naturalWidth:  img.naturalWidth,
        naturalHeight: img.naturalHeight,
        displayWidth:  img.offsetWidth,
        displayHeight: img.offsetHeight,
        hasLazyLoad:   img.loading === 'lazy',
        offsetTop:     img.getBoundingClientRect().top + window.scrollY,
        alt:           img.alt || '',
      }));
    });

    emitProgress('auditing_dark_patterns', 77);
    const darkPatterns = await detectDarkPatterns(page);

    emitProgress('testing_adblocker', 82);
    const adBlockerWall = await detectAdBlockerWall(url, browser);

    emitProgress('building_report', 86);

    // Coverage
    const jsFiles        = jsCoverageEntries.map(computeCoverage).filter(e => e.totalBytes > 0);
    const cssFiles       = cssCoverageEntries.map(computeCoverage).filter(e => e.totalBytes > 0);
    const jsTotalBytes   = jsFiles.reduce((s, e) => s + e.totalBytes, 0);
    const jsUnusedBytes  = jsFiles.reduce((s, e) => s + e.unusedBytes, 0);
    const cssTotalBytes  = cssFiles.reduce((s, e) => s + e.totalBytes, 0);
    const cssUnusedBytes = cssFiles.reduce((s, e) => s + e.unusedBytes, 0);

    // Requests
    let totalTransferBytes = 0;
    const allRequests      = [];
    const trackerSet       = new Map();

    for (const [reqUrl, req] of requestMap.entries()) {
      const res           = responseMap.get(reqUrl) || {};
      const thirdParty    = isThirdParty(reqUrl, pageHostname);
      const tracker       = detectTracker(reqUrl);
      const transferBytes = res.transferBytes || 0;
      const startMs       = requestTimings.get(reqUrl) || null;

      totalTransferBytes += transferBytes;

      if (tracker && !trackerSet.has(tracker.matchedKey)) {
        trackerSet.set(tracker.matchedKey, {
          name:         tracker.name,
          category:     tracker.category,
          severity:     tracker.severity || 'medium',
          isRTB:        tracker.isRTB    || false,
          isGoogle:     tracker.isGoogle || false,
          hostname:     tracker.hostname,
          categoryMeta: CATEGORY_META[tracker.category] || {},
        });
      }

      allRequests.push({
        url:          reqUrl,
        resourceType: req.resourceType,
        transferBytes,
        thirdParty,
        status:       res.status,
        contentType:  res.contentType,
        isTracker:    !!tracker,
        isGoogle:     isGoogleDomain(reqUrl),
        isRTB:        tracker ? (tracker.isRTB || false) : false,
        startMs,
      });
    }

    // Third-party domain summary
    const thirdPartyDomains = {};
    for (const req of allRequests.filter(r => r.thirdParty)) {
      let domain;
      try { domain = new URL(req.url).hostname; } catch { continue; }
      if (!thirdPartyDomains[domain]) {
        thirdPartyDomains[domain] = { count: 0, bytes: 0, resourceTypes: new Set(), isTracker: false, isGoogle: false };
      }
      thirdPartyDomains[domain].count++;
      thirdPartyDomains[domain].bytes    += req.transferBytes;
      thirdPartyDomains[domain].isTracker = thirdPartyDomains[domain].isTracker || req.isTracker;
      thirdPartyDomains[domain].isGoogle  = thirdPartyDomains[domain].isGoogle  || req.isGoogle;
      thirdPartyDomains[domain].resourceTypes.add(req.resourceType);
    }
    const thirdPartySummary = Object.entries(thirdPartyDomains)
      .map(([domain, d]) => ({ domain, count: d.count, bytes: d.bytes, resourceTypes: [...d.resourceTypes], isTracker: d.isTracker, isGoogle: d.isGoogle }))
      .sort((a, b) => b.bytes - a.bytes);

    const fontRequests      = allRequests.filter(r => r.resourceType === 'font' || (r.contentType && r.contentType.includes('font')));
    const thirdPartyCount   = allRequests.filter(r => r.thirdParty).length;
    const processedImages   = imageData.map(img => ({
      src:           img.src,
      naturalWidth:  img.naturalWidth,
      naturalHeight: img.naturalHeight,
      displayWidth:  img.displayWidth,
      displayHeight: img.displayHeight,
      hasLazyLoad:   img.hasLazyLoad,
      isAboveFold:   img.offsetTop < 800,
      isOversized:   img.naturalWidth > 0 && img.displayWidth > 0 && img.naturalWidth > img.displayWidth * 2,
      alt:           img.alt,
    }));

    const googleAttribution = buildGoogleAttribution(allRequests);
    const rtbCascade        = buildRtbCascade(allRequests);

    // Openness + data flow — both need trackerSet to be populated; page still loaded
    emitProgress('analyzing_openness', 88);
    const builtTrackers = [...trackerSet.values()];
    // All three probes started at navigation time — by now resolved or nearly so.
    const [rssProbe, editorialProbe, articleProbe] = await Promise.all([
      rssProbePromise, editorialProbePromise, articleProbePromise,
    ]);
    const opennessData = await analyzeOpenness(page, builtTrackers, {
      rss:      rssProbe,
      editorial: editorialProbe,
      article:  articleProbe,
    });

    emitProgress('auditing_data_flow', 91);
    const dataFlow = await auditDataFlow(page, allRequests, builtTrackers, pageHostname);

    emitProgress('auditing_paywall', 93);
    const paywallAudit = await auditPaywall(page, allRequests, builtTrackers, opennessData?.signals);

    return {
      meta: {
        url,
        analyzedAt:   new Date().toISOString(),
        durationMs:   Date.now() - startTime,
        toolVersion:  '2.2.0',
        accessBlocked: accessBlocked?.blocked ? accessBlocked : null,
      },
      trackers: builtTrackers,
      coverage: {
        jsFiles, cssFiles, jsTotalBytes, jsUnusedBytes,
        jsUnusedPercent:  jsTotalBytes  > 0 ? Math.round((jsUnusedBytes  / jsTotalBytes)  * 100) : 0,
        cssTotalBytes, cssUnusedBytes,
        cssUnusedPercent: cssTotalBytes > 0 ? Math.round((cssUnusedBytes / cssTotalBytes) * 100) : 0,
      },
      requests: {
        total: allRequests.length, thirdPartyCount,
        thirdPartyPercent: allRequests.length > 0 ? Math.round((thirdPartyCount / allRequests.length) * 100) : 0,
        byType: groupByType(allRequests),
        thirdPartySummary,
      },
      assets: {
        totalTransferBytes,
        totalTransferFormatted: formatBytes(totalTransferBytes),
        images: processedImages,
        fonts:  fontRequests,
      },
      consentAudit,
      performanceMetrics,
      googleAttribution,
      rtbCascade,
      darkPatterns,
      adBlockerWall,
      openness: opennessData,
      dataFlow,
      paywallAudit,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Classify a list of raw request URLs into the tracker shape expected by /score.
 * Used by the Live Browser Analysis skill — Claude collects URLs, Node classifies.
 *
 * @param {string[]} urls
 * @returns {{ domain, name, category, severity, isRTB, requestCount }[]}
 */
function classifyRequests(urls) {
  const seen = new Map();
  for (const url of urls) {
    const t = detectTracker(url);
    if (!t) continue;
    if (seen.has(t.matchedKey)) {
      seen.get(t.matchedKey).requestCount++;
    } else {
      seen.set(t.matchedKey, {
        domain:       t.hostname,
        name:         t.name,
        category:     t.category,
        severity:     t.severity  || 'medium',
        isRTB:        t.isRTB     || false,
        requestCount: 1,
      });
    }
  }
  return Array.from(seen.values());
}

module.exports = { analyzeUrl, classifyRequests };
