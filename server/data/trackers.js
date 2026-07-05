'use strict';

// Embedded tracker database — no runtime network fetching required.
// Each key is a hostname suffix. Matching uses hostname equality or suffix match
// to prevent substring false positives (e.g. "fakehotjar.com" won't match "hotjar.com").
//
// Categories:
//   analytics          — User behaviour analytics (surveillance-grade)
//   editorial_analytics — Publisher-focused editorial/real-time analytics (still 3rd party)
//   fingerprinting     — Session recording, mouse tracking, device fingerprinting
//   social_pixel       — Social platform surveillance pixels (track non-users across the web)
//   ssp                — Supply-Side Platforms (sell publisher inventory via RTB)
//   advertising        — Demand-side advertising, retargeting, ad servers
//   identity_resolution — Cross-device/cross-site identity graph vendors
//   data_broker        — Third-party data enrichment and audience segment providers
//   audience_measurement — Third-party audience measurement / panel verification
//   tag_manager        — Tag management systems (load arbitrary 3rd-party scripts)
//   ab_testing         — A/B testing and personalisation
//   editorial_ai       — AI systems shaping editorial decisions: recommendations, personalisation, AI paywalls
//   chat               — Live chat and support widgets
//   social             — Social media content embeds (not purely pixels)
//
// Fields:
//   name     — Human-readable tracker name
//   category — Category key (see above)
//   severity — 'critical' | 'high' | 'medium' | 'low'
//   isGoogle — true if part of the Google ecosystem (for double-bind attribution)
//   isRTB    — true if this domain participates in real-time bidding auctions

const TRACKERS = {

  // ── Analytics & User Surveillance ──────────────────────────────────────────
  'google-analytics.com':           { name: 'Google Analytics (UA)',            category: 'analytics',            severity: 'high',     isGoogle: true  },
  'analytics.google.com':           { name: 'Google Analytics 4 (GA4)',         category: 'analytics',            severity: 'high',     isGoogle: true  },
  'ssl.google-analytics.com':       { name: 'Google Analytics (SSL)',           category: 'analytics',            severity: 'high',     isGoogle: true  },
  'stats.g.doubleclick.net':        { name: 'Google Analytics (ping)',          category: 'analytics',            severity: 'high',     isGoogle: true  },
  'heap.io':                        { name: 'Heap Analytics',                   category: 'analytics',            severity: 'high'                      },
  'heapanalytics.com':              { name: 'Heap Analytics',                   category: 'analytics',            severity: 'high'                      },
  'mixpanel.com':                   { name: 'Mixpanel',                         category: 'analytics',            severity: 'high'                      },
  'amplitude.com':                  { name: 'Amplitude',                        category: 'analytics',            severity: 'high'                      },
  'api.amplitude.com':              { name: 'Amplitude (API)',                  category: 'analytics',            severity: 'high'                      },
  'segment.com':                    { name: 'Segment (Twilio)',                 category: 'analytics',            severity: 'high'                      },
  'cdn.segment.com':                { name: 'Segment CDN',                      category: 'analytics',            severity: 'high'                      },
  'api.segment.io':                 { name: 'Segment (API)',                    category: 'analytics',            severity: 'high'                      },
  'newrelic.com':                   { name: 'New Relic (Browser Agent)',        category: 'analytics',            severity: 'medium'                    },
  'bam.nr-data.net':                { name: 'New Relic Beacon',                category: 'analytics',            severity: 'medium'                    },
  'rum.hlx.page':                   { name: 'Adobe RUM',                        category: 'analytics',            severity: 'medium'                    },
  'adobedtm.com':                   { name: 'Adobe Launch / DTM',              category: 'analytics',            severity: 'high'                      },
  'omtrdc.net':                     { name: 'Adobe Analytics',                 category: 'analytics',            severity: 'high'                      },
  '2o7.net':                        { name: 'Adobe Analytics (legacy)',         category: 'analytics',            severity: 'high'                      },
  'demdex.net':                     { name: 'Adobe Audience Manager',          category: 'analytics',            severity: 'high'                      },
  'clicky.com':                     { name: 'Clicky Analytics',                category: 'analytics',            severity: 'medium'                    },
  'statcounter.com':                { name: 'StatCounter',                      category: 'analytics',            severity: 'medium'                    },
  'woopra.com':                     { name: 'Woopra',                           category: 'analytics',            severity: 'high'                      },
  'kissmetrics.com':                { name: 'Kissmetrics',                      category: 'analytics',            severity: 'high'                      },
  'piwik.pro':                      { name: 'Piwik PRO Analytics',             category: 'analytics',            severity: 'medium'                    },
  'posthog.com':                    { name: 'PostHog (cloud)',                  category: 'analytics',            severity: 'high'                      },
  'app.posthog.com':                { name: 'PostHog (cloud)',                  category: 'analytics',            severity: 'high'                      },
  'eu.posthog.com':                 { name: 'PostHog EU (cloud)',               category: 'analytics',            severity: 'high'                      },
  'plausible.io':                   { name: 'Plausible Analytics',             category: 'analytics',            severity: 'low'                       },
  'usefathom.com':                  { name: 'Fathom Analytics',                category: 'analytics',            severity: 'low'                       },

  // ── Editorial Analytics (publisher-facing, but still third-party) ──────────
  // Note: These serve newsroom editorial functions (real-time audience, recirculation)
  // but still route reader data through third-party servers.
  'chartbeat.com':                  { name: 'Chartbeat',                        category: 'editorial_analytics',  severity: 'medium'                    },
  'static.chartbeat.com':           { name: 'Chartbeat (static)',               category: 'editorial_analytics',  severity: 'medium'                    },
  'ping.chartbeat.net':             { name: 'Chartbeat Beacon',                category: 'editorial_analytics',  severity: 'medium'                    },
  'parsely.com':                    { name: 'Parse.ly',                         category: 'editorial_analytics',  severity: 'medium'                    },
  'srv.chartbeat.com':              { name: 'Chartbeat Serve',                 category: 'editorial_analytics',  severity: 'medium'                    },
  'api.parsely.com':                { name: 'Parse.ly API',                    category: 'editorial_analytics',  severity: 'medium'                    },
  'p.parsely.com':                  { name: 'Parse.ly Beacon',                 category: 'editorial_analytics',  severity: 'medium'                    },

  // ── Audience Measurement ────────────────────────────────────────────────────
  // Third-party verification services required by ad buyers; appear on nearly
  // every major news site regardless of editorial intent.
  'scorecardresearch.com':          { name: 'comScore / Scorecardresearch',    category: 'audience_measurement', severity: 'medium'                    },
  'b.scorecardresearch.com':        { name: 'comScore Beacon',                 category: 'audience_measurement', severity: 'medium'                    },
  'beacon.scorecardresearch.com':   { name: 'comScore Beacon',                 category: 'audience_measurement', severity: 'medium'                    },
  'quantserve.com':                 { name: 'Quantcast Measurement',           category: 'audience_measurement', severity: 'medium'                    },
  'quantcount.com':                 { name: 'Quantcast Counter',               category: 'audience_measurement', severity: 'medium'                    },
  'imrworldwide.com':               { name: 'Nielsen Digital Measurement',     category: 'audience_measurement', severity: 'medium'                    },
  'secure-us.imrworldwide.com':     { name: 'Nielsen (US secure)',             category: 'audience_measurement', severity: 'medium'                    },
  'cdn.piano.io':                   { name: 'Piano Analytics (formerly AT Internet)', category: 'audience_measurement', severity: 'medium'            },
  'piano.io':                       { name: 'Piano (AI Paywall + Analytics)', category: 'editorial_ai',         severity: 'high'                      },
  'cxense.com':                     { name: 'Piano/cXense (Personalisation)', category: 'editorial_ai',         severity: 'high'                      },
  'sni.cxense.com':                 { name: 'cXense Beacon',                   category: 'audience_measurement', severity: 'medium'                    },
  'comscore.com':                   { name: 'comScore',                         category: 'audience_measurement', severity: 'medium'                    },

  // ── Session Recording & Fingerprinting ─────────────────────────────────────
  // Capture full mouse, scroll, and keystroke sessions. Can inadvertently record
  // passwords, financial data, and medical queries.
  'hotjar.com':                     { name: 'Hotjar (Contentsquare)',          category: 'fingerprinting',       severity: 'critical'                  },
  'static.hotjar.com':              { name: 'Hotjar',                           category: 'fingerprinting',       severity: 'critical'                  },
  'script.hotjar.com':              { name: 'Hotjar Script',                   category: 'fingerprinting',       severity: 'critical'                  },
  'fullstory.com':                  { name: 'FullStory',                        category: 'fingerprinting',       severity: 'critical'                  },
  'rs.fullstory.com':               { name: 'FullStory Relay',                 category: 'fingerprinting',       severity: 'critical'                  },
  'clarity.ms':                     { name: 'Microsoft Clarity',               category: 'fingerprinting',       severity: 'critical'                  },
  'c.clarity.ms':                   { name: 'Microsoft Clarity Beacon',       category: 'fingerprinting',       severity: 'critical'                  },
  'mouseflow.com':                  { name: 'Mouseflow',                        category: 'fingerprinting',       severity: 'critical'                  },
  'luckyorange.com':                { name: 'Lucky Orange',                    category: 'fingerprinting',       severity: 'critical'                  },
  'crazyegg.com':                   { name: 'Crazy Egg',                       category: 'fingerprinting',       severity: 'critical'                  },
  'script.crazyegg.com':            { name: 'Crazy Egg Script',               category: 'fingerprinting',       severity: 'critical'                  },
  'logrocket.com':                  { name: 'LogRocket',                       category: 'fingerprinting',       severity: 'critical'                  },
  'cdn.logrocket.io':               { name: 'LogRocket CDN',                  category: 'fingerprinting',       severity: 'critical'                  },
  'inspectlet.com':                 { name: 'Inspectlet',                      category: 'fingerprinting',       severity: 'critical'                  },
  'cdn.iovation.com':               { name: 'iovation (Device Fingerprint)',   category: 'fingerprinting',       severity: 'critical'                  },
  'fpjs.pro':                       { name: 'FingerprintJS Pro',              category: 'fingerprinting',       severity: 'critical'                  },
  'fpcdn.io':                       { name: 'FingerprintJS Pro CDN',          category: 'fingerprinting',       severity: 'critical'                  },
  'api.fingerprint.com':            { name: 'FingerprintJS Pro API',          category: 'fingerprinting',       severity: 'critical'                  },
  'freshmarketer.com':              { name: 'Freshmarketer (Heatmaps)',        category: 'fingerprinting',       severity: 'critical'                  },
  'smartlook.com':                  { name: 'Smartlook',                       category: 'fingerprinting',       severity: 'critical'                  },
  'rec.smartlook.com':              { name: 'Smartlook Recording',            category: 'fingerprinting',       severity: 'critical'                  },
  'glassboxdigital.io':             { name: 'Glassbox (Enterprise)',          category: 'fingerprinting',       severity: 'critical'                  },

  // ── Social Surveillance Pixels ──────────────────────────────────────────────
  // Distinct from social embeds: these are pure tracking beacons that report
  // reader visits to social platforms, regardless of whether the reader uses
  // or is logged into that platform. They enable audience building for ad targeting.
  'connect.facebook.net':           { name: 'Meta/Facebook Pixel',            category: 'social_pixel',         severity: 'critical'                  },
  'facebook.com':                   { name: 'Meta/Facebook Tracking',         category: 'social_pixel',         severity: 'critical'                  },
  'pixel.facebook.com':             { name: 'Meta Pixel Endpoint',            category: 'social_pixel',         severity: 'critical'                  },
  'snap.licdn.com':                 { name: 'LinkedIn Insight Tag',           category: 'social_pixel',         severity: 'high'                      },
  'px.ads.linkedin.com':            { name: 'LinkedIn Insight Pixel',         category: 'social_pixel',         severity: 'high'                      },
  'ads.linkedin.com':               { name: 'LinkedIn Ads Tracking',          category: 'social_pixel',         severity: 'high'                      },
  'static.ads-twitter.com':         { name: 'X/Twitter Pixel',               category: 'social_pixel',         severity: 'high'                      },
  'analytics.twitter.com':          { name: 'X/Twitter Analytics',           category: 'social_pixel',         severity: 'high'                      },
  'analytics.tiktok.com':           { name: 'TikTok Pixel',                  category: 'social_pixel',         severity: 'high'                      },
  'business-api.tiktok.com':        { name: 'TikTok Events API',             category: 'social_pixel',         severity: 'high'                      },
  'ct.pinterest.com':               { name: 'Pinterest Tag',                 category: 'social_pixel',         severity: 'high'                      },
  'log.pinterest.com':              { name: 'Pinterest Tracking',            category: 'social_pixel',         severity: 'high'                      },
  'sc-static.net':                  { name: 'Snapchat Pixel',                category: 'social_pixel',         severity: 'high'                      },
  'tr.snapchat.com':                { name: 'Snapchat Tracking',             category: 'social_pixel',         severity: 'high'                      },
  'bat.bing.com':                   { name: 'Microsoft/Bing UET Tag',        category: 'social_pixel',         severity: 'high'                      },

  // ── Supply-Side Platforms (SSPs) ────────────────────────────────────────────
  // Each SSP participates in real-time bidding auctions. A single header bidding
  // wrapper can call 10-20 SSPs simultaneously, broadcasting the reader's identity
  // and page context to all of them within 100ms of page load.
  'rubiconproject.com':             { name: 'Magnite / Rubicon Project',      category: 'ssp',                  severity: 'critical', isRTB: true      },
  'fastlane.rubiconproject.com':    { name: 'Magnite Header Bid',             category: 'ssp',                  severity: 'critical', isRTB: true      },
  'magnite.com':                    { name: 'Magnite',                         category: 'ssp',                  severity: 'critical', isRTB: true      },
  'ib.adnxs.com':                   { name: 'Xandr / AppNexus (Microsoft)',   category: 'ssp',                  severity: 'critical', isRTB: true      },
  'secure.adnxs.com':               { name: 'Xandr (secure)',                 category: 'ssp',                  severity: 'critical', isRTB: true      },
  'adnxs.com':                      { name: 'Xandr / AppNexus',              category: 'ssp',                  severity: 'critical', isRTB: true      },
  'appnexus.com':                   { name: 'AppNexus (legacy)',              category: 'ssp',                  severity: 'critical', isRTB: true      },
  'casalemedia.com':                { name: 'Index Exchange',                 category: 'ssp',                  severity: 'critical', isRTB: true      },
  'indexexchange.com':              { name: 'Index Exchange',                 category: 'ssp',                  severity: 'critical', isRTB: true      },
  'ads.pubmatic.com':               { name: 'PubMatic',                       category: 'ssp',                  severity: 'critical', isRTB: true      },
  'image6.pubmatic.com':            { name: 'PubMatic Beacon',               category: 'ssp',                  severity: 'critical', isRTB: true      },
  'pubmatic.com':                   { name: 'PubMatic',                       category: 'ssp',                  severity: 'critical', isRTB: true      },
  'openx.net':                      { name: 'OpenX',                          category: 'ssp',                  severity: 'critical', isRTB: true      },
  'servedby.openx.net':             { name: 'OpenX (served)',                 category: 'ssp',                  severity: 'critical', isRTB: true      },
  'ssc.33across.com':               { name: '33Across',                       category: 'ssp',                  severity: 'critical', isRTB: true      },
  '33across.com':                   { name: '33Across',                       category: 'ssp',                  severity: 'critical', isRTB: true      },
  'rtd.triplelift.com':             { name: 'TripleLift',                     category: 'ssp',                  severity: 'critical', isRTB: true      },
  'triplelift.com':                 { name: 'TripleLift',                     category: 'ssp',                  severity: 'critical', isRTB: true      },
  'tlx.3lift.com':                  { name: 'TripleLift (Exchange)',          category: 'ssp',                  severity: 'critical', isRTB: true      },
  'sharethrough.com':               { name: 'Sharethrough',                   category: 'ssp',                  severity: 'critical', isRTB: true      },
  'sovrn.com':                      { name: 'Sovrn',                          category: 'ssp',                  severity: 'critical', isRTB: true      },
  'lijit.com':                      { name: 'Sovrn (legacy Lijit)',           category: 'ssp',                  severity: 'critical', isRTB: true      },
  'teads.tv':                       { name: 'Teads (video SSP)',              category: 'ssp',                  severity: 'critical', isRTB: true      },
  'a.teads.tv':                     { name: 'Teads Beacon',                   category: 'ssp',                  severity: 'critical', isRTB: true      },
  'hb.ybp.yahoo.com':               { name: 'Yahoo SSP (YBP)',               category: 'ssp',                  severity: 'critical', isRTB: true      },
  'aps.amazon.com':                 { name: 'Amazon Publisher Services (TAM)', category: 'ssp',                 severity: 'critical', isRTB: true      },
  'aax.amazon-adsystem.com':        { name: 'Amazon TAM / AAX',              category: 'ssp',                  severity: 'critical', isRTB: true      },
  'springserve.com':                { name: 'SpringServe (video)',            category: 'ssp',                  severity: 'critical', isRTB: true      },
  'emxdgt.com':                     { name: 'EMX Digital',                    category: 'ssp',                  severity: 'critical', isRTB: true      },
  'media.net':                      { name: 'Media.net (Indian-founded SSP)', category: 'ssp',                  severity: 'critical', isRTB: true      },
  'adserver.adtechus.com':          { name: 'Adtechus',                       category: 'ssp',                  severity: 'critical', isRTB: true      },
  'contextweb.com':                 { name: 'Pulsepoint / Contextweb',        category: 'ssp',                  severity: 'critical', isRTB: true      },
  'lfstmedia.com':                  { name: 'Lijit/Sovrn Exchange',          category: 'ssp',                  severity: 'critical', isRTB: true      },
  'bidswitch.net':                  { name: 'BidSwitch (IPONWEB)',            category: 'ssp',                  severity: 'critical', isRTB: true      },
  'prebid.org':                     { name: 'Prebid.js (header bidding)',     category: 'ssp',                  severity: 'critical', isRTB: true      },

  // ── Advertising, Retargeting & Demand-Side ──────────────────────────────────
  'doubleclick.net':                { name: 'Google Ad Manager (DoubleClick)', category: 'advertising',          severity: 'critical', isGoogle: true, isRTB: true },
  'googleadservices.com':           { name: 'Google Ad Services',             category: 'advertising',          severity: 'critical', isGoogle: true  },
  'adservice.google.com':           { name: 'Google Ad Service',              category: 'advertising',          severity: 'critical', isGoogle: true  },
  'googlesyndication.com':          { name: 'Google AdSense',                 category: 'advertising',          severity: 'critical', isGoogle: true, isRTB: true },
  'pagead2.googlesyndication.com':  { name: 'Google PageAd',                 category: 'advertising',          severity: 'critical', isGoogle: true  },
  'pubads.g.doubleclick.net':       { name: 'Google Ad Manager Publisher',    category: 'advertising',          severity: 'critical', isGoogle: true, isRTB: true },
  'adroll.com':                     { name: 'AdRoll (retargeting)',           category: 'advertising',          severity: 'high'                      },
  'd.adroll.com':                   { name: 'AdRoll Beacon',                 category: 'advertising',          severity: 'high'                      },
  'criteo.com':                     { name: 'Criteo (retargeting DSP)',       category: 'advertising',          severity: 'critical', isRTB: true      },
  'static.criteo.net':              { name: 'Criteo CDN',                     category: 'advertising',          severity: 'critical', isRTB: true      },
  'bidder.criteo.com':              { name: 'Criteo Bidder',                  category: 'advertising',          severity: 'critical', isRTB: true      },
  'taboola.com':                    { name: 'Taboola',                       category: 'editorial_ai',         severity: 'high'                      },
  'cdn.taboola.com':                { name: 'Taboola CDN',                   category: 'editorial_ai',         severity: 'high'                      },
  'trc.taboola.com':                { name: 'Taboola Recommendations',       category: 'editorial_ai',         severity: 'high'                      },
  'outbrain.com':                   { name: 'Outbrain',                       category: 'editorial_ai',         severity: 'high'                      },
  'widgets.outbrain.com':           { name: 'Outbrain Widgets',              category: 'editorial_ai',         severity: 'high'                      },
  'amazon-adsystem.com':            { name: 'Amazon Advertising',            category: 'advertising',          severity: 'critical', isRTB: true      },
  'adsrvr.org':                     { name: 'The Trade Desk (DSP)',          category: 'advertising',          severity: 'critical', isRTB: true      },
  'mookie1.com':                    { name: 'MediaMath (DSP)',               category: 'advertising',          severity: 'critical', isRTB: true      },
  'udc.yahoo.com':                  { name: 'Yahoo Advertising',             category: 'advertising',          severity: 'high'                      },
  'yahoodsp.com':                   { name: 'Yahoo DSP',                     category: 'advertising',          severity: 'critical', isRTB: true      },
  'yldbt.com':                      { name: 'Yahoo Yield (SSP)',             category: 'advertising',          severity: 'critical', isRTB: true      },
  'platform.linkedin.com':          { name: 'LinkedIn Platform (ads)',       category: 'advertising',          severity: 'medium'                    },
  't.co':                           { name: 'X/Twitter Link Tracker',        category: 'advertising',          severity: 'medium'                    },

  // ── Identity Resolution & Cross-Device Graphs ───────────────────────────────
  // These vendors build persistent pseudonymous IDs that survive cookie clearing
  // and link behaviour across devices, browsers, and offline touchpoints.
  // Every RTB bid request can carry these IDs, broadcasting reader identity
  // to all participating buyers simultaneously.
  'rlcdn.com':                      { name: 'LiveRamp (RampID)',              category: 'identity_resolution',  severity: 'critical'                  },
  'liveramp.com':                   { name: 'LiveRamp',                       category: 'identity_resolution',  severity: 'critical'                  },
  'id5-sync.com':                   { name: 'ID5 Universal ID',              category: 'identity_resolution',  severity: 'critical'                  },
  'id5api.com':                     { name: 'ID5 API',                       category: 'identity_resolution',  severity: 'critical'                  },
  'liveintent.com':                 { name: 'LiveIntent (email-anchored ID)', category: 'identity_resolution',  severity: 'critical'                  },
  'liveintentapi.com':              { name: 'LiveIntent API',                category: 'identity_resolution',  severity: 'critical'                  },
  'tapad.com':                      { name: 'Tapad (cross-device graph)',    category: 'identity_resolution',  severity: 'critical'                  },
  'neustardigital.com':             { name: 'Neustar / TransUnion',          category: 'identity_resolution',  severity: 'critical'                  },
  'netmng.com':                     { name: 'Neustar Fabrick',               category: 'identity_resolution',  severity: 'critical'                  },
  'intentiq.com':                   { name: 'Intent IQ',                     category: 'identity_resolution',  severity: 'critical'                  },
  'jadserve.postrelease.com':       { name: 'Nativo (identity)',             category: 'identity_resolution',  severity: 'high'                      },
  'epsilon.com':                    { name: 'Epsilon CORE ID (Publicis)',    category: 'identity_resolution',  severity: 'critical'                  },

  // ── Data Brokers & Third-Party Audience Segments ────────────────────────────
  // Aggregate offline purchase history, demographics, income estimates,
  // political affiliation, and health indicators for audience targeting.
  // Data ends up in RTB bid stream appended to reader identity records.
  'bluekai.com':                    { name: 'Oracle BlueKai (Data Broker)',  category: 'data_broker',          severity: 'critical'                  },
  'bkrtx.com':                      { name: 'Oracle BlueKai (exchange)',     category: 'data_broker',          severity: 'critical'                  },
  'crwdcntrl.net':                  { name: 'Lotame (DMP)',                  category: 'data_broker',          severity: 'critical'                  },
  'lotame.com':                     { name: 'Lotame',                         category: 'data_broker',          severity: 'critical'                  },
  'sharethis.com':                  { name: 'ShareThis (social data broker)', category: 'data_broker',          severity: 'critical'                  },
  'addthis.com':                    { name: 'AddThis / Oracle (data broker)', category: 'data_broker',          severity: 'critical'                  },
  'krux.com':                       { name: 'Salesforce DMP (Krux)',         category: 'data_broker',          severity: 'critical'                  },
  'krxd.net':                       { name: 'Salesforce DMP (Krux)',         category: 'data_broker',          severity: 'critical'                  },
  'sfmc.co':                        { name: 'Salesforce Marketing Cloud',    category: 'data_broker',          severity: 'high'                      },
  'exacttarget.com':                { name: 'Salesforce ExactTarget',        category: 'data_broker',          severity: 'high'                      },
  'exelate.com':                    { name: 'Nielsen eXelate (data broker)', category: 'data_broker',          severity: 'critical'                  },
  'rtdomain.exelate.com':           { name: 'Nielsen eXelate RT',           category: 'data_broker',          severity: 'critical'                  },
  'adbrain.com':                    { name: 'Adbrain (cross-device data)',   category: 'data_broker',          severity: 'critical'                  },
  'adsymptotic.com':                { name: 'Adsymptotic (audience data)',   category: 'data_broker',          severity: 'critical'                  },
  'eyeota.net':                     { name: 'Eyeota (audience segments)',    category: 'data_broker',          severity: 'critical'                  },
  'dnpthree.com':                   { name: 'DNPA / Magnite (India audience tracking)', category: 'data_broker', severity: 'critical'                },

  // ── Tag Managers ────────────────────────────────────────────────────────────
  // Load arbitrary third-party scripts dynamically. A single GTM container
  // can inject hundreds of trackers without explicit editorial awareness.
  // Represents Bridle's "opacity by design" at the level of publisher infrastructure.
  'googletagmanager.com':           { name: 'Google Tag Manager',             category: 'tag_manager',          severity: 'high',     isGoogle: true  },
  'googletagservices.com':          { name: 'Google Tag Services',            category: 'tag_manager',          severity: 'high',     isGoogle: true  },
  'tealiumiq.com':                  { name: 'Tealium iQ',                     category: 'tag_manager',          severity: 'high'                      },
  'tags.tiqcdn.com':                { name: 'Tealium CDN',                    category: 'tag_manager',          severity: 'high'                      },
  'ensighten.com':                  { name: 'Ensighten',                      category: 'tag_manager',          severity: 'high'                      },
  'nexus.ensighten.com':            { name: 'Ensighten Nexus',               category: 'tag_manager',          severity: 'high'                      },
  'qualtrics.com':                  { name: 'Qualtrics / Site Intercept',    category: 'tag_manager',          severity: 'medium'                    },
  'segment.com':                    { name: 'Segment (also acts as TMS)',    category: 'tag_manager',          severity: 'high'                      },

  // ── A/B Testing & Personalization ──────────────────────────────────────────
  'cdn.optimizely.com':             { name: 'Optimizely',                     category: 'ab_testing',           severity: 'medium'                    },
  'logx.optimizely.com':            { name: 'Optimizely Logging',            category: 'ab_testing',           severity: 'medium'                    },
  'vwo.com':                        { name: 'VWO (Visual Website Optimizer)', category: 'ab_testing',           severity: 'medium'                    },
  'dev.visualwebsiteoptimizer.com': { name: 'VWO Dev',                       category: 'ab_testing',           severity: 'medium'                    },
  'abtasty.com':                    { name: 'AB Tasty',                       category: 'ab_testing',           severity: 'medium'                    },
  'kameleoon.com':                  { name: 'Kameleoon',                      category: 'ab_testing',           severity: 'medium'                    },
  'omniconvert.com':                { name: 'Omniconvert',                    category: 'ab_testing',           severity: 'medium'                    },
  'monetate.net':                   { name: 'Monetate',                       category: 'ab_testing',           severity: 'medium'                    },
  'evergage.com':                   { name: 'Salesforce Interaction Studio',  category: 'ab_testing',           severity: 'medium'                    },
  'conductrics.com':                { name: 'Conductrics',                    category: 'ab_testing',           severity: 'medium'                    },

  // ── Editorial AI — Algorithmic systems that shape editorial decisions ────────
  // These are distinct from ad-tech: they operate on editorial infrastructure
  // itself — determining what content readers see, which headlines they read,
  // when they hit a paywall, how the publication looks for their profile.
  'dynamicyield.com':               { name: 'Dynamic Yield (Personalisation)',category: 'editorial_ai',         severity: 'high'                      },
  'sailthru.com':                   { name: 'Sailthru (Personalisation)',    category: 'editorial_ai',         severity: 'high'                      },
  'recombee.com':                   { name: 'Recombee (AI Recommendations)', category: 'editorial_ai',         severity: 'high'                      },
  'zephr.com':                      { name: 'Zephr (AI Paywall)',            category: 'editorial_ai',         severity: 'high'                      },
  'marfeel.com':                    { name: 'Marfeel (AI Editorial)',        category: 'editorial_ai',         severity: 'high'                      },
  'nativo.com':                     { name: 'Nativo (AI Native Ads)',        category: 'editorial_ai',         severity: 'medium'                    },
  'tinypass.com':                   { name: 'Piano TinyPass (Paywall)',      category: 'editorial_ai',         severity: 'high'                      },
  'viafoura.com':                   { name: 'Viafoura (AI Comments)',        category: 'editorial_ai',         severity: 'medium'                    },
  'revcontent.com':                 { name: 'RevContent (Recommendations)',  category: 'editorial_ai',         severity: 'medium'                    },
  'mgid.com':                       { name: 'MGID (AI Recommendations)',    category: 'editorial_ai',         severity: 'medium'                    },
  'gravity.com':                    { name: 'Gravity (Personalisation)',     category: 'editorial_ai',         severity: 'medium'                    },

  // ── Social Media Content Embeds ─────────────────────────────────────────────
  // Content embeds (distinct from tracking pixels above): load social platform
  // JS even when readers never interact, enabling cross-site tracking as a side effect.
  'platform.twitter.com':           { name: 'X/Twitter Widget',              category: 'social',               severity: 'medium'                    },
  'syndication.twitter.com':        { name: 'X/Twitter Embed',               category: 'social',               severity: 'medium'                    },
  'platform.instagram.com':         { name: 'Instagram Embed',               category: 'social',               severity: 'medium'                    },
  'www.instagram.com':              { name: 'Instagram',                      category: 'social',               severity: 'medium'                    },
  'apis.google.com':                { name: 'Google APIs (Social)',           category: 'social',               severity: 'low',      isGoogle: true  },
  'pinterest.com':                  { name: 'Pinterest Embed',               category: 'social',               severity: 'low'                       },
  'assets.pinterest.com':           { name: 'Pinterest Assets',              category: 'social',               severity: 'low'                       },
  'reddit.com':                     { name: 'Reddit Embed',                  category: 'social',               severity: 'low'                       },

  // ── Chat & Support Widgets ──────────────────────────────────────────────────
  'widget.intercom.io':             { name: 'Intercom Widget',               category: 'chat',                 severity: 'low'                       },
  'intercom.io':                    { name: 'Intercom',                       category: 'chat',                 severity: 'low'                       },
  'js.driftt.com':                  { name: 'Drift',                          category: 'chat',                 severity: 'low'                       },
  'drift.com':                      { name: 'Drift',                          category: 'chat',                 severity: 'low'                       },
  'client.crisp.chat':              { name: 'Crisp Chat',                    category: 'chat',                 severity: 'low'                       },
  'crisp.chat':                     { name: 'Crisp Chat',                    category: 'chat',                 severity: 'low'                       },
  'livechatinc.com':                { name: 'LiveChat',                      category: 'chat',                 severity: 'low'                       },
  'cdn.livechatinc.com':            { name: 'LiveChat CDN',                  category: 'chat',                 severity: 'low'                       },
  'zopim.com':                      { name: 'Zendesk Chat (Zopim)',          category: 'chat',                 severity: 'low'                       },
  'static.zdassets.com':            { name: 'Zendesk Assets',               category: 'chat',                 severity: 'low'                       },
  'ekr.zdassets.com':               { name: 'Zendesk Beacon',               category: 'chat',                 severity: 'low'                       },
  'freshchat.com':                  { name: 'Freshchat',                     category: 'chat',                 severity: 'low'                       },
  'wchat.freshchat.com':            { name: 'Freshchat Widget',             category: 'chat',                 severity: 'low'                       },
  'tawk.to':                        { name: 'Tawk.to',                       category: 'chat',                 severity: 'low'                       },
  'embed.tawk.to':                  { name: 'Tawk.to Embed',                category: 'chat',                 severity: 'low'                       },
  'hubspot.com':                    { name: 'HubSpot',                       category: 'chat',                 severity: 'medium'                    },
  'js.hs-scripts.com':              { name: 'HubSpot Scripts',              category: 'chat',                 severity: 'medium'                    },
  'js.hsforms.net':                 { name: 'HubSpot Forms',                category: 'chat',                 severity: 'medium'                    },
  'chatlio.com':                    { name: 'Chatlio',                       category: 'chat',                 severity: 'low'                       },
  'olark.com':                      { name: 'Olark',                         category: 'chat',                 severity: 'low'                       },
};

// ── Google Ecosystem Domains ────────────────────────────────────────────────
// Used for Google Double-Bind Attribution: measuring what % of bloat and
// requests come from Google's own infrastructure — the same company that
// penalises slow pages via Core Web Vitals.
const GOOGLE_DOMAINS = [
  'google-analytics.com',
  'analytics.google.com',
  'ssl.google-analytics.com',
  'stats.g.doubleclick.net',
  'googletagmanager.com',
  'googletagservices.com',
  'doubleclick.net',
  'googleadservices.com',
  'adservice.google.com',
  'googlesyndication.com',
  'pagead2.googlesyndication.com',
  'pubads.g.doubleclick.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
  'apis.google.com',
  'maps.googleapis.com',
  'maps.gstatic.com',
  'gstatic.com',
  'google.com',
  'googleusercontent.com',
  'youtube.com',
  'ytimg.com',
  'googlevideo.com',
];

// ── Human-readable category metadata ───────────────────────────────────────
const CATEGORY_META = {
  analytics:            { label: 'Analytics & User Surveillance',             severity: 'high',     color: '#f59e0b', icon: '📊' },
  editorial_analytics:  { label: 'Editorial Analytics (publisher-facing)',    severity: 'medium',   color: '#fb923c', icon: '📰' },
  audience_measurement: { label: 'Audience Measurement (ad verification)',    severity: 'medium',   color: '#a78bfa', icon: '📏' },
  fingerprinting:       { label: 'Session Recording & Fingerprinting',        severity: 'critical', color: '#dc2626', icon: '🖱️'  },
  social_pixel:         { label: 'Social Surveillance Pixels',                severity: 'critical', color: '#db2777', icon: '👁️'  },
  ssp:                  { label: 'Supply-Side Platforms (RTB Auction)',        severity: 'critical', color: '#7c3aed', icon: '⚡'  },
  advertising:          { label: 'Advertising & Retargeting',                 severity: 'critical', color: '#ef4444', icon: '🎯'  },
  identity_resolution:  { label: 'Identity Resolution & Cross-Device Graphs', severity: 'critical', color: '#be123c', icon: '🕸️'  },
  data_broker:          { label: 'Data Brokers & Audience Segments',          severity: 'critical', color: '#991b1b', icon: '🗄️'  },
  tag_manager:          { label: 'Tag Managers',                              severity: 'high',     color: '#ec4899', icon: '🏷️'  },
  ab_testing:           { label: 'A/B Testing & Personalisation',             severity: 'medium',   color: '#f97316', icon: '🧪'  },
  editorial_ai:         { label: 'AI Editorial Infrastructure',               severity: 'high',     color: '#0891b2', icon: '🤖'  },
  social:               { label: 'Social Media Content Embeds',               severity: 'medium',   color: '#8b5cf6', icon: '🔗'  },
  chat:                 { label: 'Chat & Support Widgets',                    severity: 'low',      color: '#3b82f6', icon: '💬'  },
};

// ── Privacy-respecting alternatives per category ────────────────────────────
const ALTERNATIVES = {
  analytics: [
    { name: 'Plausible Analytics',  url: 'https://plausible.io',           type: 'hosted',      note: 'EU-hosted, cookieless, GDPR-compliant, no cross-site tracking' },
    { name: 'Fathom Analytics',     url: 'https://usefathom.com',          type: 'hosted',      note: 'Privacy-first, simple, GDPR-compliant, Canadian company' },
    { name: 'Umami',                url: 'https://umami.is',               type: 'self-hosted', note: 'Open source, self-hosted, cookieless — you own all data' },
    { name: 'Matomo',               url: 'https://matomo.org',             type: 'self-hosted', note: 'Full-featured, open source, cookieless mode available' },
    { name: 'GoAccess',             url: 'https://goaccess.io',            type: 'self-hosted', note: 'Server-log analysis — zero client-side JS required whatsoever' },
    { name: 'Simple Analytics',     url: 'https://simpleanalytics.com',    type: 'hosted',      note: 'Lightweight, privacy-first, no cookies, Dutch company' },
  ],
  editorial_analytics: [
    { name: 'Plausible + custom events', url: 'https://plausible.io',      type: 'hosted',      note: 'Captures engaged time and scroll depth without cross-site profiling' },
    { name: 'Server-log analysis',  url: 'https://goaccess.io',            type: 'self-hosted', note: 'Real-time dashboards from your own server logs — no external scripts' },
    { name: 'Self-hosted Matomo',   url: 'https://matomo.org',             type: 'self-hosted', note: 'Full editorial metrics (time on page, recirculation) in cookieless mode' },
  ],
  fingerprinting: [
    { name: 'OpenReplay',           url: 'https://openreplay.com',         type: 'self-hosted', note: 'Open source session replay, self-hosted — you own the data, not the vendor' },
    { name: 'Remove session recording', url: null,                         type: 'practice',    note: 'For most news content, session recording has no editorial justification. Remove it entirely.' },
  ],
  social_pixel: [
    { name: 'Remove social pixels', url: null,                             type: 'practice',    note: 'Social pixels track readers who have no relationship with the platform. There is no privacy-preserving equivalent — removal is the only option.' },
    { name: 'UTM parameters',       url: null,                             type: 'practice',    note: 'Use UTM parameters in social links for attribution without installing tracking pixels on your site' },
  ],
  ssp: [
    { name: 'Direct ad sales',      url: null,                             type: 'practice',    note: 'Sell inventory directly to advertisers — no RTB, no bid-stream exposure of reader data' },
    { name: 'Contextual advertising (Seedtag, GumGum)', url: 'https://seedtag.com', type: 'hosted', note: 'Ads matched to page content, not reader identity — no reader data in the bid stream' },
    { name: 'EthicalAds',           url: 'https://www.ethicalads.io',      type: 'hosted',      note: 'Privacy-preserving, contextual-only, no tracking' },
    { name: 'Carbon Ads',           url: 'https://www.carbonads.net',      type: 'hosted',      note: 'Contextual, developer-focused, no behavioural tracking' },
  ],
  advertising: [
    { name: 'Contextual advertising', url: null,                           type: 'practice',    note: 'Serve ads based on page content rather than reader identity — contextual ads can match or exceed surveillance ad revenue (see: Dutch public broadcaster NPO)' },
    { name: 'EthicalAds',           url: 'https://www.ethicalads.io',      type: 'hosted',      note: 'Privacy-preserving, no tracking' },
    { name: 'Direct sponsorship',   url: null,                             type: 'practice',    note: 'Editorial sponsorship and native advertising without reader data' },
  ],
  identity_resolution: [
    { name: 'Remove entirely',      url: null,                             type: 'practice',    note: 'Identity resolution is structurally incompatible with reader privacy. It exists to build persistent profiles for ad targeting — there is no privacy-preserving version of this function.' },
    { name: 'First-party data strategy', url: null,                        type: 'practice',    note: 'Build direct, consensual relationships with readers through registration and newsletters — no third-party identity graph required' },
  ],
  data_broker: [
    { name: 'Remove entirely',      url: null,                             type: 'practice',    note: 'Data broker integrations route reader data to companies that aggregate offline personal records. Remove them.' },
  ],
  audience_measurement: [
    { name: 'Server-side log analytics', url: 'https://goaccess.io',       type: 'self-hosted', note: 'Accurate audience measurement from server logs — no reader-side scripts required' },
    { name: 'Direct advertiser reporting', url: null,                      type: 'practice',    note: 'Share first-party audience data directly with advertisers via clean rooms, without third-party measurement pixels' },
  ],
  ab_testing: [
    { name: 'GrowthBook',           url: 'https://www.growthbook.io',      type: 'self-hosted', note: 'Open source A/B testing platform, self-hosted — no third-party data exposure' },
    { name: 'Server-side testing',  url: null,                             type: 'practice',    note: 'Split traffic at the server or CDN edge — zero client-side JS, zero flicker, zero tracking' },
    { name: 'LaunchDarkly (server-side)', url: 'https://launchdarkly.com', type: 'hosted',      note: 'Feature flags evaluated server-side — reader data never leaves your infrastructure' },
  ],
  tag_manager: [
    { name: 'Load scripts directly', url: null,                            type: 'practice',    note: 'Load only the scripts you actually need — tag managers create opacity and often fire trackers automatically without editorial awareness' },
    { name: 'Partytown',            url: 'https://partytown.builder.io',   type: 'library',     note: 'Runs third-party scripts in a web worker — preserves performance without removing third-party scripts' },
    { name: 'Piwik PRO Tag Manager', url: 'https://piwik.pro',             type: 'hosted',      note: 'Privacy-first tag manager with consent management built in' },
  ],
  chat: [
    { name: 'Simple contact form',  url: null,                             type: 'practice',    note: 'Most chat widgets load 200–600 KB of JavaScript on every page load. A contact form costs nothing.' },
    { name: 'Chatwoot (self-hosted)', url: 'https://www.chatwoot.com',     type: 'self-hosted', note: 'Open source live chat — self-hosted, you control all conversation data' },
  ],
  editorial_ai: [
    { name: 'Editorial curation',   url: null,                             type: 'practice',    note: 'Human editors selecting "related articles" is slower but produces coverage that reflects editorial judgment rather than click optimisation' },
    { name: 'Stringer (open-source recs)', url: 'https://github.com/swanson/stringer', type: 'self-hosted', note: 'Self-hosted RSS reader — readers build their own feeds, removing the recommendation layer entirely' },
    { name: 'Remove algorithmic recs', url: null,                          type: 'practice',    note: 'Taboola/Outbrain "recommended" widgets generate revenue but systematically degrade editorial context. The Guardian removed them in 2016, citing brand integrity.' },
  ],
  social: [
    { name: 'Static share links',   url: null,                             type: 'practice',    note: 'Simple <a href="..."> share links load no external JavaScript and track nothing' },
    { name: 'Click-to-activate embeds', url: null,                         type: 'practice',    note: 'Show a placeholder image; load the social embed JS only after the reader clicks — consent implicit' },
  ],
};

module.exports = { TRACKERS, GOOGLE_DOMAINS, CATEGORY_META, ALTERNATIVES };
