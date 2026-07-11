'use strict';

/**
 * /score endpoint — Live Browser Analysis scoring.
 *
 * Claude collects raw signals from a real browser via Chrome MCP tools,
 * serialises them as JSON, and POSTs here. This module maps those signals
 * to the analysis object shape expected by scoring functions, runs all
 * scoring, and returns a result structurally identical to /api/analyze.
 *
 * ADR-0003: single implementation of truth — scoring rubric lives in Node,
 * not in Claude's prompt. Changes to the rubric propagate automatically.
 */

const { assembleAnalysisResult } = require('./analysisResult');
const { scoreOpenness } = require('./openness');

// Hostname suffix match — "sub.doubleclick.net" matches "doubleclick.net";
// "evil-doubleclick.net.attacker.com" does not (unlike a substring check).
function domainMatches(domain, base) {
  if (!domain) return false;
  const d = String(domain).toLowerCase();
  return d === base || d.endsWith('.' + base);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Map a Live Browser signal payload → analysis object → scores.
 *
 * @param {object} payload
 * @param {string} payload.url
 * @param {string} [payload.mode='live-browser']
 * @param {object[]} [payload.trackers=[]]          - { domain, name, category, requestCount? }
 * @param {object[]} [payload.requests=[]]           - raw request list (used for count fallback)
 * @param {object}  [payload.domData={}]             - boolean DOM signals collected by Claude
 * @param {number|null} [payload.requestCount]       - total request count from network tab
 * @param {number|null} [payload.transferKB]         - total transfer size in KB (null if unavailable)
 * @param {number|null} [payload.ttfb]               - TTFB ms from Navigation Timing API
 * @param {number|null} [payload.lcp]                - LCP ms (null — unavailable in Live Browser)
 * @param {number|null} [payload.tbt]                - TBT ms (null — unavailable in Live Browser)
 * @returns {object} - Same shape as /api/analyze complete result
 */
function scoreFromSignals(payload) {
  const {
    url,
    mode = 'live-browser',
    trackers = [],
    requests = [],
    domData = {},
    requestCount = null,
    transferKB = null,
    ttfb = null,
    lcp = null,
    tbt = null,
  } = payload;

  // ── RTB / header bidding from tracker categories ─────────────────────────
  const sspTrackers = trackers.filter(t => t.category === 'ssp');
  const sspCount = sspTrackers.length;
  const participantNames = sspTrackers.map(t => t.name || t.domain || 'unknown');

  const rtbCascade = {
    count:                  sspCount > 0 ? 1 : 0,
    headerBiddingDetected:  sspCount >= 2,
    uniqueParticipants:     sspCount,
    participantNames,
  };

  // ── Google double-bind ───────────────────────────────────────────────────
  const hasGAM = trackers.some(t =>
    t.category === 'advertising' &&
    (t.name?.includes('Google Ad Manager') || t.name?.includes('DoubleClick') ||
     domainMatches(t.domain, 'doubleclick.net') || domainMatches(t.domain, 'googlesyndication.com'))
  );
  const hasGA = trackers.some(t =>
    t.category === 'analytics' &&
    (t.name?.includes('Google Analytics') || domainMatches(t.domain, 'google-analytics.com') ||
     domainMatches(t.domain, 'googletagmanager.com'))
  );
  const googleAttribution = { isDoubleBind: hasGAM && hasGA };

  // ── Consent audit ────────────────────────────────────────────────────────
  const consentAudit = {
    consentBannerDetected:        domData.consentBannerPresent       ?? false,
    trackersFireBeforeConsent:    domData.trackersFireBeforeConsent   ?? false,
    preConsentThirdPartyCount:    domData.preConsentThirdPartyCount   ?? 0,
  };

  // ── Dark patterns ────────────────────────────────────────────────────────
  const darkPatterns = {
    bannerFound:      domData.consentBannerPresent ?? false,
    pretickedBoxes:   domData.pretickedBoxes       ?? 0,
    hasNoRejectOption:domData.hasNoRejectOption     ?? false,
    patternCount:     domData.darkPatternCount      ?? 0,
    summary:          domData.darkPatternSummary    ?? '',
  };

  // ── Ad blocker wall ──────────────────────────────────────────────────────
  const adBlockerWall = {
    wallDetected: domData.adBlockerWallDetected ?? false,
    wallType:     domData.adBlockerWallType     ?? 'none',
    summary:      domData.adBlockerWallSummary  ?? '',
  };

  // ── Assets ───────────────────────────────────────────────────────────────
  // transferKB null → 0 bytes → pageBloatScore skips weight deduction (correct:
  // unknown weight should not be penalised or rewarded; request count still fires)
  const assets = {
    totalTransferBytes: transferKB != null ? Math.round(transferKB * 1024) : 0,
    images: [],
    fonts:  [],
  };

  // ── Coverage — unavailable in Live Browser mode ──────────────────────────
  // Zeroed out so coverage branches in pageBloatScore() are skipped cleanly.
  const coverage = {
    jsTotalBytes:   0,
    jsUnusedBytes:  0,
    cssTotalBytes:  0,
    cssUnusedBytes: 0,
  };

  // ── Requests ─────────────────────────────────────────────────────────────
  const thirdPartyCount = trackers.reduce((sum, t) => sum + (t.requestCount || 1), 0);
  const totalRequests   = requestCount ?? requests.length ?? 0;
  const requestsShape   = { total: totalRequests, thirdPartyCount };

  // ── Performance ──────────────────────────────────────────────────────────
  // lcp and tbt are always null in Live Browser mode (no PerformanceObserver
  // or Coverage API). ttfb comes from Navigation Timing API via javascript_tool.
  const performanceMetrics = { lcp, tbt, ttfb };

  // ── Openness ─────────────────────────────────────────────────────────────
  // Single canonical scorer (openness.js). Adapt the Live Browser signal bag
  // into the DOM shape it expects, then delegate — no drifting second copy.
  const openness = scoreOpenness(_opennessDom(domData), _opennessTrackers(domData, trackers));

  // ── Paywall audit — minimal shape from domData ───────────────────────────
  const wallType = domData.paywallType || 'none';
  const paywallAudit = wallType !== 'none'
    ? {
        score:            domData.paywallScore           ?? 50,
        platform:         domData.paywallPlatform        ?? 'unknown',
        profilesPlatform: domData.paywallProfilesPlatform ?? false,
        signals:          { surveillanceCount: 0, duplicateCallCount: 0 },
        dimensions:       {},
      }
    : null;

  // ── Assemble analysis object ─────────────────────────────────────────────
  const analysis = {
    url,
    mode,
    trackers,
    rtbCascade,
    googleAttribution,
    consentAudit,
    darkPatterns,
    adBlockerWall,
    assets,
    coverage,
    requests:           requestsShape,
    performanceMetrics,
    openness,
    paywallAudit,
  };

  // ── Score ────────────────────────────────────────────────────────────────
  // Track which signals were unavailable — shown as flags in the report card
  const missingSignals = [
    'jsCoverage',                                   // always missing in live browser
    ...(lcp      == null ? ['lcp']        : []),
    ...(tbt      == null ? ['tbt']        : []),
    ...(transferKB == null ? ['transferKB'] : []),
  ];

  return assembleAnalysisResult(analysis, { mode: 'live-browser', missingSignals });
}

// ── Live Browser → openness.js adapters ──────────────────────────────────────
// scoreOpenness(dom, trackers) infers the wall type from paywall arrays and the
// AI-editorial signals from trackers. Live Browser instead hands us a flat
// signal bag: a `paywallType` string and pre-classified AI booleans. These two
// helpers translate that bag into the exact shape the canonical scorer reads,
// so Live Browser and Headless run identical scoring logic.

function _opennessDom(domData) {
  const wall = domData.paywallType || 'none';
  return {
    // Wall type is carried by which array is non-empty (openness.js reads .length).
    paywallEls:     [],
    hardPaywall:    wall === 'hard'         ? ['live-browser: hard paywall'] : [],
    meteredPaywall: wall === 'metered'      ? ['live-browser: metered wall'] : [],
    regWall:        wall === 'registration' ? ['live-browser: registration'] : [],
    // Participation / accessibility booleans (absent Live Browser signals stay false).
    hasRss:             !!domData.hasRss,
    hasBylines:         !!domData.hasBylines,
    hasComments:        !!domData.hasComments,
    hasCorrections:     !!domData.hasCorrections,
    hasContact:         !!domData.hasContact,
    hasEditorialPolicy: !!domData.hasEditorialPolicy,
    hasCreativeCommons: !!domData.hasCreativeCommons,
    altRatio:           domData.altRatio ?? 0,
    hasMain:            !!domData.hasMain,
    // AI-editorial DOM signals.
    hasAlgoWidgets:     !!domData.hasAlgoWidgets,
    aiDisclosures:      domData.aiDisclosures ?? [],
    htmlLang:           domData.htmlLang ?? 'en',
  };
}

// openness.js derives AI-editorial penalties from trackers. Live Browser may
// instead flag them as booleans; synthesise matching trackers so the same
// detection fires. Real trackers are kept — `.some()` checks make dups harmless.
function _opennessTrackers(domData, trackers) {
  const synth = [];
  if (domData.hasAlgoRecs)          synth.push({ name: 'Taboola', category: 'advertising' });
  if (domData.hasPredictivePaywall) synth.push({ name: 'Piano',   category: 'editorial_ai' });
  if (domData.hasHeadlineTesting)   synth.push({ name: 'A/B Test', category: 'ab_testing' });
  return synth.length ? [...trackers, ...synth] : trackers;
}

module.exports = { scoreFromSignals };
