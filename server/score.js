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

const { democraticInfrastructureScore, scoreGrade, computeFlags } = require('./scoring');
const { opennessGrade } = require('./openness');
const { paywallGrade } = require('./paywallAudit');
const { generateRecommendations } = require('./recommendations');

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
  const openness = _opennessFromSignals(domData);

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
  const dis   = democraticInfrastructureScore(analysis);
  const flags = computeFlags(analysis);
  const open  = openness;

  // Track which signals were unavailable — shown as flags in the report card
  const missingSignals = [
    'jsCoverage',                                   // always missing in live browser
    ...(lcp      == null ? ['lcp']        : []),
    ...(tbt      == null ? ['tbt']        : []),
    ...(transferKB == null ? ['transferKB'] : []),
  ];

  const result = {
    ...analysis,
    scores: {
      overall:      dis.overall,
      overallGrade: scoreGrade(dis.overall),
      dimensions:   dis.dimensions,
      dimensionGrades: Object.fromEntries(
        Object.entries(dis.dimensions).map(([k, v]) => [k, scoreGrade(v)])
      ),
      flags,
      openness:      open.overall,
      opennessGrade: opennessGrade(open.overall),
      opennessDimensions: open.dimensions,
      opennessDimensionGrades: Object.fromEntries(
        Object.entries(open.dimensions || {}).map(([k, v]) => [k, opennessGrade(v)])
      ),
      ...(paywallAudit ? {
        paywallScore:      paywallAudit.score,
        paywallGrade:      paywallGrade(paywallAudit.score),
        paywallDimensions: paywallAudit.dimensions,
      } : {}),
      // Legacy aliases — report generator compatibility
      pageHealth:      dis.dimensions.pageBloat,
      pageHealthGrade: scoreGrade(dis.dimensions.pageBloat),
      privacy:         dis.dimensions.surveillance,
      privacyGrade:    scoreGrade(dis.dimensions.surveillance),
      // Live Browser mode metadata
      _liveBrowserMode: true,
      _missingSignals:  missingSignals,
    },
    recommendations: generateRecommendations(analysis),
  };

  return result;
}

// ── Openness from boolean signals ────────────────────────────────────────────
/**
 * Compute openness score from DOM boolean signals collected by Claude.
 * Simplified version of analyzeOpenness() for Live Browser mode — no Playwright.
 *
 * Weights mirror openness.js: access 40%, participation 40%, aiEditorial 20%.
 */
function _opennessFromSignals(domData) {
  // Access sub-score
  let accessScore = 100;
  const wallType = domData.paywallType || 'none';
  if (wallType === 'hard')         accessScore -= 40;
  if (wallType === 'metered')      accessScore -= 20;
  if (wallType === 'registration') accessScore -= 10;

  // Participation sub-score — mirrors openness.js point allocation
  let participationScore = 0;
  if (domData.hasRss)             participationScore += 18;
  if (domData.hasAbout)           participationScore += 10;
  if (domData.hasEditorialPolicy) participationScore += 12;
  if (domData.hasCorrections)     participationScore += 14;
  if (domData.hasContact)         participationScore += 10;
  if (domData.hasBylines)         participationScore += 16;
  participationScore = Math.min(100, participationScore);

  // AI/editorial control sub-score
  let aiScore = 100;
  if (domData.hasAlgoRecs)          aiScore -= 35;
  if (domData.hasPredictivePaywall) aiScore -= 25;
  if (domData.hasHeadlineTesting)   aiScore -= 15;
  aiScore = Math.max(0, aiScore);

  const overall = Math.round(
    accessScore        * 0.40 +
    participationScore * 0.40 +
    aiScore            * 0.20
  );

  // signals shape expected by computeFlags()
  const aiSignals = [];
  if (domData.hasAlgoRecs)          aiSignals.push({ id: 'algo_recs' });
  if (domData.hasPredictivePaywall) aiSignals.push({ id: 'ai_paywall' });
  if (domData.hasHeadlineTesting)   aiSignals.push({ id: 'headline_testing' });
  if (aiSignals.length === 0)       aiSignals.push({ id: 'no_ai_detected' });

  return {
    overall: Math.max(0, Math.min(100, overall)),
    dimensions: {
      access:        Math.max(0, Math.min(100, accessScore)),
      participation: participationScore,
      aiEditorial:   aiScore,
    },
    signals: {
      wallType,
      hasRss:    domData.hasRss ?? false,
      aiSignals,
    },
  };
}

module.exports = { scoreFromSignals };
