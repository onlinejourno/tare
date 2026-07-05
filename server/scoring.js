'use strict';

// Clamp to 0–100.
function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

// ── Dimension 1: Surveillance Score (higher = less surveillance) ─────────────
// Measures the depth and severity of the tracking apparatus deployed against readers.
// Weighted by category severity per the book's framework:
//   fingerprinting / identity resolution = critical (cross-session, cross-device)
//   data brokers / social pixels         = critical (feeds offline-online profiles)
//   SSPs / RTB participants              = critical (broadcasts to 50–200 buyers)
//   analytics (surveillance-grade)       = high
//   editorial analytics                  = medium (serves newsroom but still 3rd party)

function surveillanceScore(analysis) {
  let score = 100;
  const { trackers, rtbCascade } = analysis;

  const byCategory = {};
  for (const t of trackers) {
    if (!byCategory[t.category]) byCategory[t.category] = 0;
    byCategory[t.category]++;
  }

  // Session recording & device fingerprinting — can capture passwords, health queries
  score -= Math.min(40, (byCategory.fingerprinting      || 0) * 15);
  // Identity resolution — persistent cross-device/cross-session profiles
  score -= Math.min(35, (byCategory.identity_resolution || 0) * 15);
  // Data brokers — enrich profiles with offline purchase/demographic data
  score -= Math.min(30, (byCategory.data_broker         || 0) * 12);
  // Social pixels — report reading behaviour to social platforms; track non-users
  score -= Math.min(35, (byCategory.social_pixel        || 0) * 10);
  // SSPs — each one receives reader identity in the RTB bid stream
  score -= Math.min(30, (byCategory.ssp                 || 0) * 8);
  // Surveillance-grade analytics (GA4 feeds Google ad ecosystem)
  score -= Math.min(20, (byCategory.analytics           || 0) * 7);
  // Editorial analytics (Chartbeat, Parse.ly — still third-party, but newsroom-facing)
  score -= Math.min(12, (byCategory.editorial_analytics || 0) * 4);
  // Audience measurement (comScore, Quantcast — required by ad buyers)
  score -= Math.min(10, (byCategory.audience_measurement|| 0) * 4);
  // Tag managers — opacity multipliers: load arbitrary trackers dynamically
  score -= Math.min(15, (byCategory.tag_manager         || 0) * 8);
  // Social embeds — tracking side effect of content widgets
  score -= Math.min(8,  (byCategory.social              || 0) * 3);
  // Chat widgets
  score -= Math.min(5,  (byCategory.chat                || 0) * 2);

  // RTB header bidding: if 3+ SSPs fire simultaneously, data broadcast is systemic
  if (rtbCascade && rtbCascade.headerBiddingDetected) score -= 15;

  return clamp(score);
}

// ── Dimension 2: Ad-Tech Depth Score (higher = less ad-tech infrastructure) ──
// Measures participation in the programmatic advertising ecosystem.
// The RTB auction is the specific mechanism described in the book's governing
// case study: a single page load broadcasting reader identity to hundreds of
// intermediaries in ~100ms.

function adTechDepthScore(analysis) {
  let score = 100;
  const { trackers, rtbCascade } = analysis;

  // RTB auction detected: readers' identity and page context broadcast to all bidders
  if (rtbCascade && rtbCascade.count > 0) score -= 30;

  // Header bidding: multiple simultaneous RTB auctions = data sent to more companies
  if (rtbCascade && rtbCascade.headerBiddingDetected) score -= 20;

  // Each additional SSP in the header bidding stack = another set of buyers
  const sspCount = trackers.filter(t => t.category === 'ssp').length;
  score -= Math.min(25, sspCount * 6);

  // Demand-side advertising (retargeting DSPs, ad networks)
  const adCount = trackers.filter(t => t.category === 'advertising').length;
  score -= Math.min(15, adCount * 4);

  // Google Ad Manager is specifically singled out: the double-bind operator
  const hasGAM = trackers.some(t =>
    t.category === 'advertising' && (t.name.includes('Google Ad Manager') || t.name.includes('DoubleClick'))
  );
  if (hasGAM) score -= 10;

  return clamp(score);
}

// ── Dimension 3: Consent & Paywall Integrity Score (higher = more honest) ────
// Merged dimension: measures honesty at both the consent gate (cookie/tracking
// UI) and the access gate (paywall). Both share the same moral axis — does the
// publisher treat readers honestly at the gates it puts in front of them?
//
// Blend: 70% consent sub-score + 30% paywall sub-score.
// Falls back to 100% consent when no paywall platform is detected.

function consentPaywallIntegrityScore(analysis) {
  const { consentAudit, trackers, darkPatterns, adBlockerWall, paywallAudit } = analysis;

  // ── Consent sub-score (existing logic) ───────────────────────────────────
  let consentScore = 100;

  if (consentAudit) {
    const hasTrackers = trackers.length > 0;
    if (!consentAudit.consentBannerDetected && hasTrackers) consentScore -= 50;
    if (consentAudit.trackersFireBeforeConsent) consentScore -= 35;
    const preCount = consentAudit.preConsentThirdPartyCount || 0;
    if (preCount > 0) consentScore -= Math.min(15, preCount * 1.5);
    if (darkPatterns && darkPatterns.bannerFound) {
      if (darkPatterns.pretickedBoxes > 0)    consentScore -= 22;
      if (darkPatterns.hasNoRejectOption)     consentScore -= 25;
      else if (darkPatterns.patternCount > 0) consentScore -= Math.min(18, darkPatterns.patternCount * 7);
    }
    if (adBlockerWall && adBlockerWall.wallDetected) {
      consentScore -= adBlockerWall.wallType === 'hard' ? 28 : 16;
    }
  }

  consentScore = clamp(consentScore);

  // ── Blend with paywall sub-score ──────────────────────────────────────────
  if (paywallAudit && typeof paywallAudit.score === 'number') {
    return clamp(Math.round(consentScore * 0.70 + paywallAudit.score * 0.30));
  }
  return consentScore;
}

// ── Dimension 4: Page Bloat Score (higher = less bloated) ────────────────────
// Measures the material weight of the page — particularly important for
// Indian mobile users on constrained data plans, as described in Chapter 4.
// Page bloat caused by ad-tech infrastructure is a democratic access barrier.

function pageBloatScore(analysis) {
  let score = 100;
  const { coverage, assets, requests } = analysis;

  // Total page weight
  const totalMB = assets.totalTransferBytes / (1024 * 1024);
  if      (totalMB > 8)  score -= 40;
  else if (totalMB > 5)  score -= 30;
  else if (totalMB > 3)  score -= 20;
  else if (totalMB > 2)  score -= 12;
  else if (totalMB > 1)  score -= 6;

  // Unused JavaScript (news sites typically carry 60–80% unused JS — mostly ad-tech)
  if (coverage.jsTotalBytes > 0) {
    const pct = (coverage.jsUnusedBytes / coverage.jsTotalBytes) * 100;
    if      (pct > 80) score -= 25;
    else if (pct > 65) score -= 18;
    else if (pct > 50) score -= 10;
    else if (pct > 35) score -= 5;
  }

  // Unused CSS
  if (coverage.cssTotalBytes > 0) {
    const pct = (coverage.cssUnusedBytes / coverage.cssTotalBytes) * 100;
    if      (pct > 85) score -= 12;
    else if (pct > 70) score -= 8;
    else if (pct > 55) score -= 4;
  }

  // Third-party request ratio
  if (requests.total > 0) {
    const ratio = requests.thirdPartyCount / requests.total;
    if      (ratio > 0.7) score -= 15;
    else if (ratio > 0.5) score -= 10;
    else if (ratio > 0.35) score -= 5;
  }

  // Total request count (high count = many round trips)
  if      (requests.total > 150) score -= 10;
  else if (requests.total > 80)  score -= 5;

  // Oversized images
  const oversized = (assets.images || []).filter(i => i.isOversized).length;
  score -= Math.min(8, oversized * 2);

  // Web fonts — each is a render-blocking request
  const fontCount = (assets.fonts || []).length;
  if (fontCount > 6) score -= 8;
  else if (fontCount > 3) score -= 4;

  return clamp(score);
}

// ── Dimension 5: Performance Impact Score (higher = faster) ──────────────────
// Measures actual loading speed impact. Important context: Google's Core Web
// Vitals create a double-bind — the same company whose ad ecosystem causes
// the bloat also runs the algorithm that penalises sites for it.

function performanceImpactScore(analysis) {
  let score = 100;
  const pm = analysis.performanceMetrics;
  if (!pm || Object.values(pm).every(v => v === null)) return score;

  // LCP (Largest Contentful Paint) — main article headline/image load time
  if (pm.lcp !== null) {
    if      (pm.lcp > 6000) score -= 35;
    else if (pm.lcp > 4000) score -= 25;
    else if (pm.lcp > 2500) score -= 12;
  }

  // TBT (Total Blocking Time) — how long ad/tracker scripts block interactivity
  if (pm.tbt !== null) {
    if      (pm.tbt > 800)  score -= 25;
    else if (pm.tbt > 400)  score -= 15;
    else if (pm.tbt > 200)  score -= 8;
  }

  // TTFB (Time to First Byte) — server response speed
  if (pm.ttfb !== null) {
    if      (pm.ttfb > 2000) score -= 20;
    else if (pm.ttfb > 1000) score -= 10;
    else if (pm.ttfb > 600)  score -= 5;
  }

  return clamp(score);
}

// ── Dimension 6: Openness Score ───────────────────────────────────────────────
// Delegates to the openness.js composite (access + participation + aiEditorial).
// Returns 50 as a neutral fallback when openness data is unavailable.

function opennessDimensionScore(analysis) {
  return clamp(analysis.openness?.overall ?? 50);
}

// ── Composite: Democratic Infrastructure Score ────────────────────────────────
// Is this publication's technical infrastructure compatible with its democratic
// function as a news publisher?
//
// Six dimensions — weights sum to 100%:
//   Surveillance (25%)              — depth of tracking apparatus
//   Ad-Tech Depth (20%)             — RTB/programmatic participation
//   Page Bloat (18%)                — weight, unused code, request count
//   Consent & Paywall Integrity (17%) — honesty at consent + access gates (merged)
//   Openness (12%)                  — access, participation, AI editorial control
//   Performance (8%)                — LCP, TBT, TTFB
//
// Higher = more reader-respecting. Below 40 = structurally incompatible with
// the publication's democratic function.

function democraticInfrastructureScore(analysis) {
  const surveillance    = surveillanceScore(analysis);
  const adTech          = adTechDepthScore(analysis);
  const consentPaywall  = consentPaywallIntegrityScore(analysis);
  const bloat           = pageBloatScore(analysis);
  const performance     = performanceImpactScore(analysis);
  const openness        = opennessDimensionScore(analysis);

  const composite = Math.round(
    surveillance   * 0.25 +
    adTech         * 0.20 +
    bloat          * 0.18 +
    consentPaywall * 0.17 +
    openness       * 0.12 +
    performance    * 0.08
  );

  return {
    overall: clamp(composite),
    dimensions: {
      surveillance,
      adTechDepth:             adTech,
      consentPaywallIntegrity: consentPaywall,
      pageBloat:               bloat,
      openness,
      performance,
    },
  };
}

// ── Grade helpers ─────────────────────────────────────────────────────────────

// Reader-respect scale — DELIBERATELY DISTINCT from the OnlineJourno suite's
// A-F table (grades.py / bands.json: 80/65/50/35). This tool grades reader
// treatment, not editorial quality; its C/D boundaries (45/25) and labels
// (Reader-Respecting ... Egregious) are its own, pinned by scoring.test.js.
// Founder decision 2026-07-04 (checklist P2.2 option b). Do not "unify".
function scoreGrade(score) {
  if (score >= 80) return { grade: 'A', label: 'Reader-Respecting', colorClass: 'green'  };
  if (score >= 65) return { grade: 'B', label: 'Moderate',          colorClass: 'lime'   };
  if (score >= 45) return { grade: 'C', label: 'Concerning',        colorClass: 'amber'  };
  if (score >= 25) return { grade: 'D', label: 'Exploitative',      colorClass: 'orange' };
  return                   { grade: 'F', label: 'Egregious',         colorClass: 'red'    };
}

function dimensionLabel(key) {
  return {
    surveillance:             'Surveillance',
    adTechDepth:              'Ad-Tech Depth',
    consentPaywallIntegrity:  'Consent & Paywall Integrity',
    pageBloat:                'Page Bloat',
    openness:                 'Openness',
    performance:              'Performance',
    // Legacy key — kept for report generator compatibility
    consentIntegrity:         'Consent Integrity',
  }[key] || key;
}

// ── Flags (badges shown on dashboard) ────────────────────────────────────────

function computeFlags(analysis) {
  const flags = [];
  const { trackers, rtbCascade, consentAudit, googleAttribution, darkPatterns, adBlockerWall } = analysis;

  const hasCategory = (cat) => trackers.some(t => t.category === cat);

  if (rtbCascade && rtbCascade.count > 0)
    flags.push({ id: 'rtb_broadcaster',    label: 'RTB Broadcaster',      severity: 'critical', icon: '⚡', note: 'Broadcasts reader identity to ad buyers via real-time auction' });
  if (rtbCascade && rtbCascade.headerBiddingDetected)
    flags.push({ id: 'header_bidding',     label: 'Header Bidding',       severity: 'critical', icon: '📡', note: `${rtbCascade.uniqueParticipants} SSPs receive reader data simultaneously` });
  if (hasCategory('fingerprinting'))
    flags.push({ id: 'fingerprinter',      label: 'Session Recording',    severity: 'critical', icon: '🖱️',  note: 'Records every mouse movement, scroll, and click' });
  if (hasCategory('identity_resolution'))
    flags.push({ id: 'identity_graph',     label: 'Identity Resolution',  severity: 'critical', icon: '🕸️',  note: 'Persistent cross-device/cross-session reader profiling' });
  if (hasCategory('data_broker'))
    flags.push({ id: 'data_broker',        label: 'Data Broker',          severity: 'critical', icon: '🗄️',  note: 'Links browsing behaviour to offline demographic/purchase data' });
  if (consentAudit && consentAudit.trackersFireBeforeConsent)
    flags.push({ id: 'pre_consent',        label: 'Pre-Consent Fires',    severity: 'critical', icon: '🚨', note: 'Trackers fire before consent banner renders (likely GDPR violation)' });
  if (!consentAudit?.consentBannerDetected && trackers.length > 0)
    flags.push({ id: 'no_consent_banner',  label: 'No Consent UI',        severity: 'critical', icon: '⛔', note: 'No consent management platform detected despite trackers being present' });
  if (googleAttribution && googleAttribution.isDoubleBind)
    flags.push({ id: 'google_double_bind', label: 'Google Double-Bind',   severity: 'high',     icon: '🔄', note: 'Google Ad Manager causes the bloat; Google Core Web Vitals penalises it' });
  if (hasCategory('social_pixel') && trackers.filter(t => t.category === 'social_pixel').length >= 3)
    flags.push({ id: 'social_surveillance',label: 'Social Surveillance',  severity: 'high',     icon: '👁️',  note: '3+ social platform pixels tracking readers across the web' });

  // Dark patterns in consent UI
  if (darkPatterns && darkPatterns.bannerFound && darkPatterns.patternCount > 0) {
    const dp = darkPatterns;
    const sev = (dp.pretickedBoxes > 0 || dp.hasNoRejectOption) ? 'critical' : 'high';
    flags.push({ id: 'dark_patterns', label: `Consent Dark Patterns (${dp.patternCount})`, severity: sev, icon: '🎭',
      note: dp.summary });
  }

  // Ad blocker wall: site penalises readers for self-defence
  if (adBlockerWall && adBlockerWall.wallDetected) {
    flags.push({ id: 'adblock_wall',
      label: adBlockerWall.wallType === 'hard' ? 'Hard Ad-Block Wall' : 'Soft Ad-Block Wall',
      severity: adBlockerWall.wallType === 'hard' ? 'critical' : 'high',
      icon: '🚧',
      note: adBlockerWall.summary });
  }

  // ── Openness flags ────────────────────────────────────────────────────────
  const opennessSignals  = analysis.openness?.signals  || {};
  const aiSignals        = opennessSignals.aiSignals   || [];
  const paywallAuditData = analysis.paywallAudit;

  if (aiSignals.some(s => s.id === 'algo_recs'))
    flags.push({ id: 'algo_recs',         label: 'Algorithmic Editorial',     severity: 'high',     icon: '🤖', note: 'Taboola/Outbrain-style widgets replace editorial curation with engagement-maximising algorithms' });
  if (aiSignals.some(s => s.id === 'ai_paywall'))
    flags.push({ id: 'predictive_paywall',label: 'Predictive Paywall',        severity: 'high',     icon: '🎯', note: 'ML model decides when to trigger subscription wall based on each reader\'s predicted propensity to pay' });
  if (aiSignals.some(s => s.id === 'headline_testing'))
    flags.push({ id: 'headline_testing',  label: 'Headline A/B Testing',      severity: 'medium',   icon: '🔀', note: 'Different readers see different headlines; click-rate metrics shift editorial voice toward engagement optimisation' });
  if (opennessSignals.wallType === 'hard')
    flags.push({ id: 'hard_paywall',      label: 'Hard Paywall',              severity: 'medium',   icon: '🔒', note: 'Journalism is inaccessible without a subscription — restricts democratic access to information' });
  if (opennessSignals.hasRss === false)
    flags.push({ id: 'no_rss',            label: 'No Open Feed',              severity: 'low',      icon: '📵', note: 'No RSS/Atom feed — readers must rely on platform algorithms to follow coverage' });

  // ── Paywall Audit flags ───────────────────────────────────────────────────
  if (paywallAuditData?.profilesPlatform && (paywallAuditData.signals?.surveillanceCount || 0) > 0)
    flags.push({ id: 'paywall_profiling', label: 'Paywall Profiling',         severity: 'high',     icon: '👤', note: `${paywallAuditData.platform} builds behavioural profiles of all visitors — including non-subscribers — to predict subscription likelihood` });
  if ((paywallAuditData?.signals?.duplicateCallCount || 0) > 0)
    flags.push({ id: 'paywall_bloat',     label: 'Paywall Request Bloat',     severity: 'medium',   icon: '📦', note: `Duplicate paywall platform endpoint calls detected — accumulated rule complexity inflating reader data transmitted per page load` });

  // ── Positive flags ────────────────────────────────────────────────────────
  const privacyAnalytics = trackers.filter(t =>
    t.category === 'analytics' && (t.name.includes('Plausible') || t.name.includes('Fathom') || t.name.includes('Simple Analytics'))
  );
  if (privacyAnalytics.length > 0)
    flags.push({ id: 'privacy_analytics',    label: 'Privacy Analytics',        severity: 'positive', icon: '✅', note: 'Uses a privacy-respecting analytics platform' });
  if (!rtbCascade || rtbCascade.count === 0)
    flags.push({ id: 'no_rtb',               label: 'No RTB',                   severity: 'positive', icon: '✅', note: 'No real-time bidding auction detected' });
  if (opennessSignals.hasRss === true)
    flags.push({ id: 'open_feed',            label: 'Open Feed',                severity: 'positive', icon: '✅', note: 'RSS/Atom feed available — readers can follow coverage without algorithmic intermediation' });
  if (aiSignals.some(s => s.id === 'no_ai_detected'))
    flags.push({ id: 'no_algo_editorial',    label: 'No Algorithmic Editorial', severity: 'positive', icon: '✅', note: 'No algorithmic recommendation, personalisation, or AI paywall systems detected' });

  return flags;
}

module.exports = {
  surveillanceScore,
  adTechDepthScore,
  consentPaywallIntegrityScore,
  opennessDimensionScore,
  pageBloatScore,
  performanceImpactScore,
  democraticInfrastructureScore,
  scoreGrade,
  dimensionLabel,
  computeFlags,
  // Legacy aliases
  pageHealthScore:      pageBloatScore,
  privacyScore:         surveillanceScore,
  consentIntegrityScore: consentPaywallIntegrityScore,
};
