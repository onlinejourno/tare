'use strict';

const { ALTERNATIVES } = require('./data/trackers');

function fmt(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function names(trackers) {
  return [...new Set(trackers.map(t => t.name))].join(', ');
}

function generateRecommendations(analysis) {
  const recs = [];
  const { trackers, coverage, assets, requests, rtbCascade, consentAudit, googleAttribution } = analysis;

  const byCategory = {};
  for (const t of trackers) {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  }

  // ── RTB / Programmatic (highest priority) ────────────────────────────────────
  if (rtbCascade && rtbCascade.count > 0) {
    const hb = rtbCascade.headerBiddingDetected;
    recs.push({
      id: 'rtb-auction',
      severity: 'critical',
      title: `Real-time bidding auction detected — ${rtbCascade.uniqueParticipants} companies receive your readers' data`,
      detail: hb
        ? `Header bidding is running with ${rtbCascade.uniqueParticipants} simultaneous SSPs (${rtbCascade.participantNames.slice(0,5).join(', ')}${rtbCascade.participantNames.length > 5 ? '…' : ''}). ` +
          'In the ~100ms before the page loads, a bid request containing the reader\'s identity, location, device, and page context is broadcast to all of them — and through them to their downstream DSP buyers. ' +
          'This is not a metaphor. It is the literal technical operation described in The Digital Mirror\'s governing case study.'
        : `Programmatic advertising detected (${rtbCascade.participantNames.slice(0,4).join(', ')}). ` +
          'Each ad request broadcasts reader identity and page context to the receiving ad network and its downstream buyers.',
      alternatives: ALTERNATIVES.ssp || [],
    });
  }

  // ── Identity resolution ───────────────────────────────────────────────────────
  if (byCategory.identity_resolution) {
    recs.push({
      id: 'identity-resolution',
      severity: 'critical',
      title: 'Identity resolution vendors build persistent cross-device reader profiles',
      detail: `Detected: ${names(byCategory.identity_resolution)}. ` +
        'These vendors link reader activity across devices, browsers, and offline touchpoints using probabilistic and deterministic matching. ' +
        'The resulting "identity graph" is carried in the RTB bid stream as extended IDs (eids), meaning every ad auction broadcasts not just anonymous browsing data but a pseudonymous persistent identity. ' +
        'Identity resolution is structurally incompatible with reader privacy. It exists to enable targeting — there is no privacy-preserving version of this function.',
      alternatives: ALTERNATIVES.identity_resolution || [],
    });
  }

  // ── Data brokers ─────────────────────────────────────────────────────────────
  if (byCategory.data_broker) {
    recs.push({
      id: 'data-broker',
      severity: 'critical',
      title: 'Data broker integrations expose readers to offline demographic profiling',
      detail: `Detected: ${names(byCategory.data_broker)}. ` +
        'Data brokers aggregate offline purchase history, income estimates, political affiliation, and health indicators with online browsing behaviour. ' +
        'Reader data from this site is being merged with records that were never disclosed to readers.',
      alternatives: ALTERNATIVES.data_broker || [],
    });
  }

  // ── Session recording & fingerprinting ───────────────────────────────────────
  if (byCategory.fingerprinting) {
    recs.push({
      id: 'session-recording',
      severity: 'critical',
      title: 'Session recording captures every reader interaction — including sensitive content',
      detail: `Detected: ${names(byCategory.fingerprinting)}. ` +
        'These tools record every mouse movement, scroll position, click, and (without careful masking) keystrokes on every page visit. ' +
        'On a news site, this means the vendor can see which articles a reader views about health, politics, religion, or legal issues. ' +
        'Multiple EU regulators have ruled session recording illegal without explicit opt-in consent.',
      alternatives: ALTERNATIVES.fingerprinting || [],
    });
  }

  // ── Social surveillance pixels ────────────────────────────────────────────────
  if (byCategory.social_pixel) {
    recs.push({
      id: 'social-pixels',
      severity: 'critical',
      title: `Social surveillance pixels report reading behaviour to ${byCategory.social_pixel.length} platform(s)`,
      detail: `Detected: ${names(byCategory.social_pixel)}. ` +
        'These pixels fire regardless of whether the reader uses the platform or is logged in. ' +
        'They enable the social platform to associate a visit to this page with an advertising profile — even for readers who have never signed up. ' +
        'They also bypass browser privacy protections when implemented as server-side conversion APIs (CAPI).',
      alternatives: ALTERNATIVES.social_pixel || [],
    });
  }

  // ── Consent timing ────────────────────────────────────────────────────────────
  if (consentAudit) {
    if (consentAudit.trackersFireBeforeConsent) {
      recs.push({
        id: 'pre-consent-fires',
        severity: 'critical',
        title: 'Trackers fire before consent banner renders — likely GDPR violation',
        detail: `${consentAudit.preConsentThirdPartyCount} third-party requests fired before the consent banner appeared. ` +
          'Under GDPR, non-essential processing requires prior consent. Loading trackers before the user has the opportunity to consent is technically illegal. ' +
          'This pattern is extremely common in news publishing — the DNPA-Magnite infrastructure deal in India was built after the DPDP Act passed, with the same structural logic.',
        alternatives: [
          { name: 'Block third-party tags until consent', url: null, type: 'practice', note: 'Configure your CMP to block all non-essential scripts until the user explicitly accepts' },
          { name: 'Piwik PRO Tag Manager', url: 'https://piwik.pro', type: 'hosted', note: 'Privacy-first tag manager with consent-gating built in' },
        ],
      });
    } else if (!consentAudit.consentBannerDetected && trackers.length > 0) {
      recs.push({
        id: 'no-consent-ui',
        severity: 'critical',
        title: 'No consent management platform detected despite active trackers',
        detail: `${trackers.length} trackers were found but no consent banner or CMP was detected. ` +
          'Processing personal data without a consent mechanism violates GDPR and similar privacy laws in many jurisdictions. ' +
          'India\'s DPDP Act similarly requires consent for data processing.',
        alternatives: [
          { name: 'Cookiebot', url: 'https://www.cookiebot.com', type: 'hosted', note: 'Automated consent management with scanner' },
          { name: 'Piwik PRO CMP', url: 'https://piwik.pro', type: 'hosted', note: 'Privacy-first consent management' },
        ],
      });
    }
  }

  // ── Google double-bind ────────────────────────────────────────────────────────
  if (googleAttribution && googleAttribution.isDoubleBind) {
    recs.push({
      id: 'google-double-bind',
      severity: 'high',
      title: 'Google double-bind detected: ad tech causes bloat that Google\'s algorithm penalises',
      detail: `Google Tag Manager and Google Ad Manager are both present. ` +
        // Live Browser mode has no per-request attribution — omit the numbers there.
        (typeof googleAttribution.requestPercent === 'number'
          ? `Google's advertising ecosystem accounts for ${googleAttribution.requestPercent}% of all requests and ${googleAttribution.bytesPercent}% of transferred bytes. `
          : '') +
        'The same company whose ad exchange requires these scripts also runs Core Web Vitals — which penalises slow pages in search rankings. ' +
        'This is platform capture operating on both sides of the publisher\'s business simultaneously.',
      alternatives: [
        { name: 'Contextual advertising', url: null, type: 'practice', note: 'Replace Google Ad Manager with contextual advertising — removes the dependency that creates the double-bind' },
        { name: 'Direct ad sales infrastructure', url: 'https://www.kevel.com', type: 'hosted', note: 'Kevel or Equativ for direct sales without Google\'s ecosystem' },
      ],
    });
  }

  // ── Analytics ────────────────────────────────────────────────────────────────
  if (byCategory.analytics) {
    recs.push({
      id: 'analytics',
      severity: 'high',
      title: 'Replace surveillance analytics with privacy-respecting alternatives',
      detail: `Detected: ${names(byCategory.analytics)}. ` +
        'Google Analytics 4 is explicitly designed to feed Google\'s advertising ecosystem — analytics data can be used for ad personalisation unless specifically opted out. ' +
        'Privacy-first analytics provide equivalent traffic insights without exposing reader data to third-party servers.',
      alternatives: ALTERNATIVES.analytics || [],
    });
  }

  // ── Editorial analytics ───────────────────────────────────────────────────────
  if (byCategory.editorial_analytics) {
    recs.push({
      id: 'editorial-analytics',
      severity: 'medium',
      title: 'Editorial analytics route reader data through third-party servers',
      detail: `Detected: ${names(byCategory.editorial_analytics)}. ` +
        'These tools serve genuine editorial functions — real-time story performance, engaged time, recirculation — but still route reader behaviour through external servers. ' +
        'Self-hosted or privacy-first alternatives can provide the same editorial insights with full data sovereignty.',
      alternatives: ALTERNATIVES.editorial_analytics || [],
    });
  }

  // ── Tag managers ─────────────────────────────────────────────────────────────
  if (byCategory.tag_manager) {
    recs.push({
      id: 'tag-manager',
      severity: 'high',
      title: 'Tag managers create structural opacity — anyone with access can inject trackers',
      detail: `Detected: ${names(byCategory.tag_manager)}. ` +
        'Tag managers are the mechanism by which dozens of trackers are deployed without explicit editorial awareness. ' +
        'A single GTM container can silently add new tracking vendors. ' +
        'This is the institutional ignorance described in Chapter 3 — editorial leadership cannot audit infrastructure they have effectively ceded.',
      alternatives: ALTERNATIVES.tag_manager || [],
    });
  }

  // ── A/B testing ───────────────────────────────────────────────────────────────
  if (byCategory.ab_testing) {
    recs.push({
      id: 'ab-testing',
      severity: 'medium',
      title: 'Client-side A/B testing blocks rendering and exposes user data',
      detail: `Detected: ${names(byCategory.ab_testing)}. ` +
        'Client-side A/B testing scripts load synchronously — they must run before the page renders to avoid flicker. ' +
        'This blocks the main thread, adds latency, and sends experiment assignment data to the vendor. ' +
        'Server-side testing eliminates all three problems.',
      alternatives: ALTERNATIVES.ab_testing || [],
    });
  }

  // ── Social embeds ─────────────────────────────────────────────────────────────
  if (byCategory.social) {
    recs.push({
      id: 'social-embeds',
      severity: 'medium',
      title: 'Social media embeds track readers even when they don\'t interact',
      detail: `Detected: ${names(byCategory.social)}. ` +
        'Social embed scripts load and execute on every page view, sending data to the social platform regardless of whether the reader clicks or engages. ' +
        'Static share links (<a href="...">) have zero tracking and zero JavaScript cost.',
      alternatives: ALTERNATIVES.social || [],
    });
  }

  // ── Coverage ──────────────────────────────────────────────────────────────────
  if (coverage.jsTotalBytes > 0) {
    const pct = Math.round((coverage.jsUnusedBytes / coverage.jsTotalBytes) * 100);
    if (pct > 55) {
      recs.push({
        id: 'unused-js',
        severity: pct > 75 ? 'high' : 'medium',
        title: `${pct}% of JavaScript is shipped but never executes`,
        detail: `${fmt(coverage.jsUnusedBytes)} of ${fmt(coverage.jsTotalBytes)} total JavaScript is downloaded but unused on initial load. ` +
          'For news sites, most of this is ad-tech infrastructure that loads even on pages without ads. ' +
          'Enable code splitting (dynamic import()) and tree-shaking in your bundler.',
        alternatives: [],
      });
    }
  }

  if (coverage.cssTotalBytes > 0) {
    const pct = Math.round((coverage.cssUnusedBytes / coverage.cssTotalBytes) * 100);
    if (pct > 65) {
      recs.push({
        id: 'unused-css',
        severity: pct > 82 ? 'high' : 'medium',
        title: `${pct}% of CSS is unused`,
        detail: `${fmt(coverage.cssUnusedBytes)} of CSS is downloaded but never applied. ` +
          'Use PurgeCSS or Tailwind\'s built-in purge to remove unused rules. Consider page-specific stylesheets instead of one global bundle.',
        alternatives: [],
      });
    }
  }

  // ── Assets ────────────────────────────────────────────────────────────────────
  const totalMB = assets.totalTransferBytes / (1024 * 1024);
  if (totalMB > 3) {
    recs.push({
      id: 'page-weight',
      severity: totalMB > 6 ? 'high' : 'medium',
      title: `Total page weight is ${totalMB.toFixed(1)} MB — a democratic access barrier on mobile`,
      detail: 'In India, where the majority of news consumption is on mobile devices — often on constrained data plans — ' +
        'page weight is not a performance inconvenience but an access barrier. ' +
        'A reader paying per megabyte is subsidising ad-tech infrastructure with their data allowance. ' +
        `This page requires ${totalMB.toFixed(1)} MB per visit.`,
      alternatives: [],
    });
  }

  const oversized = (assets.images || []).filter(i => i.isOversized).length;
  if (oversized > 0) {
    recs.push({
      id: 'oversized-images',
      severity: 'medium',
      title: `${oversized} image${oversized > 1 ? 's are' : ' is'} served larger than displayed`,
      detail: 'Images served at their natural resolution but displayed at a fraction of that size waste bandwidth on every page load. ' +
        'Use srcset / sizes attributes, and serve modern formats (WebP, AVIF).',
      alternatives: [],
    });
  }

  const lazyMissing = (assets.images || []).filter(i => !i.hasLazyLoad && !i.isAboveFold).length;
  if (lazyMissing > 0) {
    recs.push({
      id: 'lazy-loading',
      severity: 'low',
      title: `${lazyMissing} below-fold image${lazyMissing > 1 ? 's' : ''} missing lazy loading`,
      detail: 'Below-fold images download immediately on page load, competing with critical resources. Add loading="lazy" to all non-critical images.',
      alternatives: [],
    });
  }

  if ((assets.fonts || []).length > 4) {
    recs.push({
      id: 'web-fonts',
      severity: 'low',
      title: `${assets.fonts.length} web font files load on every page`,
      detail: 'Each font file is a separate network request. Limit to 1–2 typefaces, use system font stacks where possible, and add font-display: swap.',
      alternatives: [],
    });
  }

  return recs;
}

module.exports = { generateRecommendations };
