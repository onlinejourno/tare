'use strict';

const { gradeTier } = require('./grades');
const { WALL_TYPE } = require('./signals');

// ── Known paywall/subscription platform domains ───────────────────────────────
// Grouped by how much reader surveillance they add beyond basic gating.
const PAYWALL_PLATFORMS = [
  // Piano ecosystem — most sophisticated profiling
  { domain: 'tinypass.com',        name: 'Piano',                    profiles: true  },
  { domain: 'piano.io',            name: 'Piano',                    profiles: true  },
  { domain: 'api-v3.tinypass.com', name: 'Piano API',                profiles: true  },
  { domain: 'buy.tinypass.com',    name: 'Piano Checkout',           profiles: false },
  { domain: 'cdn.tinypass.com',    name: 'Piano CDN',                profiles: false },
  { domain: 'cxense.com',          name: 'Cxense (Piano DMP)',        profiles: true  },
  { domain: 'recs.cxense.com',     name: 'Cxense Recommendations',   profiles: true  },
  // AI-driven / propensity platforms
  { domain: 'zephr.com',           name: 'Zephr',                    profiles: true  },
  { domain: 'dynamicyield.com',    name: 'Dynamic Yield',            profiles: true  },
  { domain: 'sailthru.com',        name: 'Sailthru',                 profiles: true  },
  { domain: 'marfeel.com',         name: 'Marfeel',                  profiles: true  },
  // Commerce / billing platforms (lower profiling risk)
  { domain: 'zuora.com',           name: 'Zuora',                    profiles: false },
  { domain: 'chargebee.com',       name: 'Chargebee',                profiles: false },
  { domain: 'recurly.com',         name: 'Recurly',                  profiles: false },
  { domain: 'stripe.com',          name: 'Stripe',                   profiles: false },
  { domain: 'plenigo.com',         name: 'Plenigo',                  profiles: false },
  { domain: 'accesstype.com',      name: 'AccessType (Quintype)',     profiles: false },
  { domain: 'laterpay.net',        name: 'LaterPay',                 profiles: false },
  { domain: 'poool.fr',            name: 'Poool',                    profiles: true  },
  { domain: 'leaky-paywall.com',   name: 'Leaky Paywall',            profiles: false },
  { domain: 'memberful.com',       name: 'Memberful',                profiles: false },
  { domain: 'substack.com',        name: 'Substack',                 profiles: false },
  { domain: 'ghost.io',            name: 'Ghost Memberships',        profiles: false },
];

// Surveillance-specific endpoint patterns (mostly Piano, but generalisable)
const SURVEILLANCE_ENDPOINTS = [
  { pattern: 'logAutoMicroConversion', label: 'Micro-conversion tracking'      },
  { pattern: 'experience/execute',      label: 'Paywall rule engine execution'  },
  { pattern: 'publisher/user',          label: 'Reader profile lookup'          },
  { pattern: 'cxense.com/Repo',         label: 'DMP data push (Cxense)'        },
  { pattern: 'piano.cxense.com',        label: 'Piano–Cxense data bridge'      },
  { pattern: 'propensity',              label: 'Propensity score computation'   },
  { pattern: 'likelihood',              label: 'Conversion likelihood scoring'  },
  { pattern: 'ltx',                     label: 'LTx propensity model call'     },
];

// DOM selectors for paywall containers
const PAYWALL_SELECTORS = [
  '.tp-modal', '#tp-container', '.tp-backdrop', '#piano-offer',
  '[class*="paywall"]', '[id*="paywall"]',
  '[class*="subscribe-wall"]', '[class*="subscription-wall"]',
  '[class*="metered-paywall"]', '[class*="article-paywall"]',
  '[class*="premium-gate"]', '[class*="content-gate"]',
  '[class*="subscribe-prompt"]', '[id*="subscribe-prompt"]',
  '.regwall', '#regwall', '[class*="regwall"]',
  '[class*="access-denied"]', '[class*="locked-content"]',
];

// DOM selectors for "already subscribed? sign in" UX
const LOGIN_SELECTORS = [
  'a[href*="login"]', 'a[href*="signin"]', 'a[href*="sign-in"]',
  'a[href*="account"]', 'button[class*="login"]', 'button[class*="signin"]',
  '[class*="subscriber-login"]', '[class*="already-subscriber"]',
  '[class*="sign-in"]', '[data-testid*="login"]',
];

function matchesDomain(url, domain) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === domain || h.endsWith('.' + domain);
  } catch { return false; }
}

function getBaseUrl(url) {
  try { const u = new URL(url); return u.hostname + u.pathname; } catch { return url; }
}

// ── Main export ───────────────────────────────────────────────────────────────

async function auditPaywall(page, allRequests, trackers, opennessSignals) {
  // Openness signals name the wall-type field `wallType` (see openness.js).
  const paywallType = opennessSignals?.wallType || WALL_TYPE.NONE;

  // ── Platform detection ────────────────────────────────────────────────────
  const detectedPlatforms = new Map(); // domain → platform info
  const paywallRequests   = [];

  for (const req of allRequests) {
    for (const plat of PAYWALL_PLATFORMS) {
      if (matchesDomain(req.url, plat.domain)) {
        detectedPlatforms.set(plat.domain, plat);
        paywallRequests.push({ ...req, platformDomain: plat.domain });
        break;
      }
    }
  }

  // Also check editorial_ai trackers (already classified in tracker DB)
  const paywallTrackers = trackers.filter(t => t.category === 'editorial_ai');

  const hasAnyPaywallPlatform = detectedPlatforms.size > 0 || paywallTrackers.length > 0;

  // If no platform detected AND no paywall in content, skip this section
  if (!hasAnyPaywallPlatform && paywallType === WALL_TYPE.NONE) return null;

  // Primary platform name (prefer Piano if present, else first detected)
  const platformList = [...detectedPlatforms.values()];
  const primaryPlatform = platformList.find(p => p.name.includes('Piano'))
    || platformList[0]
    || (paywallTrackers[0] ? { name: paywallTrackers[0].name, profiles: true } : null)
    || { name: 'Unknown', profiles: false };

  const profilesPlatform = [...detectedPlatforms.values()].some(p => p.profiles)
    || paywallTrackers.some(t => t.severity === 'high');

  // ── Call counts by platform ───────────────────────────────────────────────
  const callsByPlatform = {};
  for (const req of paywallRequests) {
    const plat = detectedPlatforms.get(req.platformDomain);
    if (!plat) continue;
    const key = plat.name;
    callsByPlatform[key] = (callsByPlatform[key] || 0) + 1;
  }
  const totalPlatformCalls = paywallRequests.length;

  // Duplicate call detection
  const baseCounts = {};
  for (const req of paywallRequests) {
    const base = getBaseUrl(req.url);
    baseCounts[base] = (baseCounts[base] || 0) + 1;
  }
  const duplicateCalls = Object.entries(baseCounts)
    .filter(([, count]) => count >= 2)
    .map(([url, count]) => ({ url: url.slice(0, 80), count }));

  // ── Surveillance endpoint detection ──────────────────────────────────────
  const detectedSurveillance = SURVEILLANCE_ENDPOINTS.filter(ep =>
    allRequests.some(r => r.url.toLowerCase().includes(ep.pattern.toLowerCase()))
  );

  // ── DOM quality signals ───────────────────────────────────────────────────
  let domSignals = {
    paywallVisible: false, hasLoginLink: false, loginLinkText: null,
    hasPricing: false, hasGiftOption: false, hasMeterCounter: false,
    hasManageSubscription: false, visibleArticleParagraphs: 0,
  };
  try {
    domSignals = await page.evaluate((pwSels, loginSels) => {
      const find = (sels) => sels.map(s => { try { return document.querySelector(s); } catch { return null; } }).find(Boolean);
      const paywallEl = find(pwSels);
      const loginEl   = find(loginSels);

      const articleEl = document.querySelector('article, [class*="article-body"], [class*="story-body"], .article-text, #content, main');
      const visibleParas = articleEl
        ? Array.from(articleEl.querySelectorAll('p')).filter(p => p.textContent.trim().length > 60).length
        : 0;

      const bodyText = document.body.innerText || '';
      return {
        paywallVisible:           !!paywallEl,
        hasLoginLink:             !!loginEl,
        loginLinkText:            loginEl ? loginEl.textContent.trim().slice(0, 60) : null,
        hasPricing:               /₹\s*\d+|Rs\.?\s*\d+|\$\s*\d+|€\s*\d+|£\s*\d+|\d+\s*per\s*(month|year|week)|\d+\s*\/(mo|yr|month|year)/i.test(bodyText),
        hasGiftOption:            /gift\s+article|send\s+this\s+article|share\s+free/i.test(bodyText),
        hasMeterCounter:          /\d+\s+(free\s+)?(article|story|read)s?\s+(left|remaining|this\s+month)/i.test(bodyText),
        hasManageSubscription:    /manage\s+(your\s+)?subscription|my\s+account|subscriber\s+benefit/i.test(bodyText),
        visibleArticleParagraphs: visibleParas,
      };
    }, PAYWALL_SELECTORS, LOGIN_SELECTORS);
  } catch {}

  // ── Scoring ───────────────────────────────────────────────────────────────

  // 1. Transparency — does the reader understand the paywall terms?
  let transparency = 50;
  if (domSignals.hasLoginLink)        transparency += 20;
  if (domSignals.hasPricing)          transparency += 15;
  if (domSignals.hasMeterCounter)     transparency += 10;
  if (domSignals.hasGiftOption)       transparency += 5;
  if (domSignals.hasManageSubscription) transparency += 5;
  if (paywallType === WALL_TYPE.HARD)         transparency -= 20;
  if (paywallType === WALL_TYPE.METERED)      transparency += 5;
  if (profilesPlatform && detectedSurveillance.length > 0) transparency -= 15; // profiling undisclosed
  transparency = Math.max(0, Math.min(100, transparency));

  // 2. Technical hygiene — is the implementation clean and proportionate?
  let hygiene = 100;
  if (totalPlatformCalls > 25)        hygiene -= 35;
  else if (totalPlatformCalls > 15)   hygiene -= 20;
  else if (totalPlatformCalls > 8)    hygiene -= 10;
  else if (totalPlatformCalls > 4)    hygiene -= 5;
  hygiene -= Math.min(30, duplicateCalls.length * 12);
  hygiene -= Math.min(15, detectedSurveillance.length * 5);
  hygiene = Math.max(0, Math.min(100, hygiene));

  // 3. Reader respect — does the implementation treat readers fairly?
  let readerRespect = 80;
  if (paywallType === WALL_TYPE.HARD)              readerRespect -= 40;
  else if (paywallType === WALL_TYPE.REGISTRATION) readerRespect -= 20;
  if (profilesPlatform)                    readerRespect -= 15;
  if (detectedSurveillance.some(s => s.pattern.includes('logAutoMicroConversion')))
                                           readerRespect -= 10;
  if (domSignals.visibleArticleParagraphs < 3 && paywallType !== WALL_TYPE.NONE)
                                           readerRespect -= 15;
  readerRespect = Math.max(0, Math.min(100, readerRespect));

  // 4. Performance — what is the network overhead of the paywall stack?
  let performance = 100;
  if (totalPlatformCalls > 25)        performance -= 35;
  else if (totalPlatformCalls > 15)   performance -= 20;
  else if (totalPlatformCalls > 8)    performance -= 10;
  else if (totalPlatformCalls > 3)    performance -= 5;
  performance = Math.max(0, Math.min(100, performance));

  const composite = Math.max(0, Math.min(100, Math.round(
    transparency  * 0.30 +
    hygiene       * 0.35 +
    readerRespect * 0.25 +
    performance   * 0.10
  )));

  // ── Privacy / reader rights issues ────────────────────────────────────────
  const privacyIssues = [];

  if (profilesPlatform) {
    privacyIssues.push({
      severity: 'high',
      label: 'Behavioural reader profiling before subscription',
      note: `${primaryPlatform.name} builds a behavioural profile of every visitor — including non-subscribers — to predict their "likelihood to subscribe." This happens before any consent to subscription is given, and the profiling is not disclosed to readers.`,
    });
  }

  if (detectedSurveillance.some(s => s.pattern.includes('logAutoMicroConversion'))) {
    privacyIssues.push({
      severity: 'high',
      label: 'Micro-conversion surveillance on every page view',
      note: 'The paywall platform logs every page view as a "micro-conversion event" — treating reading as a step in a commercial funnel. This data (what you read, when, for how long) flows to the platform\'s servers whether or not you ever subscribe.',
    });
  }

  if (detectedSurveillance.some(s => s.pattern.includes('experience/execute'))) {
    privacyIssues.push({
      severity: 'medium',
      label: 'Paywall rule engine runs on every page load',
      note: 'The platform\'s Composer/rule engine evaluates your reader profile (segments, propensity scores, meter counts) against a set of commercial rules on every article page — a hidden decision system that determines what content you can access based on your reading history.',
    });
  }

  if (duplicateCalls.length > 0) {
    privacyIssues.push({
      severity: 'medium',
      label: `Duplicate tracking calls (${duplicateCalls.length} repeated endpoint${duplicateCalls.length > 1 ? 's' : ''})`,
      note: `The same paywall endpoint is being called ${duplicateCalls[0]?.count || 'multiple'} times per page load. This inflates behavioural data on the platform's side and is a symptom of accumulated rule complexity — the paywall system has grown without audit.`,
    });
  }

  if (totalPlatformCalls > 10) {
    privacyIssues.push({
      severity: 'medium',
      label: `High paywall platform call volume (${totalPlatformCalls} requests)`,
      note: `${totalPlatformCalls} network requests to ${primaryPlatform.name} detected per page load. High call volumes indicate accumulated meters, segments, recommendation widgets, and tracking events — each additional call transmits more reader data to the platform's servers.`,
    });
  }

  if (!domSignals.hasLoginLink && paywallType !== WALL_TYPE.NONE) {
    privacyIssues.push({
      severity: 'low',
      label: 'No clear subscriber sign-in path',
      note: 'Existing subscribers may be unable to easily identify themselves, leading to unnecessary paywall encounters and forcing re-authentication flows.',
    });
  }

  return {
    detected:        true,
    platform:        primaryPlatform.name,
    platformList:    [...new Set(platformList.map(p => p.name))],
    profilesPlatform,
    hasPiano:        detectedPlatforms.has('tinypass.com') || detectedPlatforms.has('piano.io') || detectedPlatforms.has('api-v3.tinypass.com'),
    hasCxense:       detectedPlatforms.has('cxense.com') || detectedPlatforms.has('recs.cxense.com'),
    paywallType,
    score:           composite,
    dimensions:      { transparency, hygiene, readerRespect, performance },
    signals: {
      totalPlatformCalls,
      callsByPlatform,
      duplicateCallCount:   duplicateCalls.length,
      duplicateCalls,
      surveillanceCount:    detectedSurveillance.length,
      detectedSurveillance: detectedSurveillance.map(s => s.label),
      ...domSignals,
    },
    privacyIssues,
  };
}

// Band cutoffs owned by grades.js; paywallGrade keeps its bare-string interface.
const PAYWALL_GRADE_LABELS = ['Respectful', 'Functional', 'Problematic', 'Reader-Hostile', 'Broken / Opaque'];
function paywallGrade(score) { return PAYWALL_GRADE_LABELS[gradeTier(score)]; }

module.exports = { auditPaywall, paywallGrade };
