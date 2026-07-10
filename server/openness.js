'use strict';

const { upgradeDomSignals } = require('./signalProbes');

const { extractOpennessSignals, emptyDomSignals, EXTRACT_ARGS } = require('./opennessExtract');

// Editorial AI systems — names checked against the live tracker list
const AI_EDITORIAL_NAMES = [
  'Taboola', 'Outbrain', 'Dynamic Yield', 'Piano', 'TinyPass',
  'Sailthru', 'Nativo', 'Recombee', 'Zephr', 'Marfeel',
  'Viafoura', 'Chorus', 'Arc XP',
];

// ── DOM Analysis (runs inside the page) ──────────────────────────────────────

async function analyzeOpenness(page, trackers, probeData = {}) {
  let domData;
  try {
    domData = await page.evaluate(extractOpennessSignals, EXTRACT_ARGS);
  } catch (err) {
    domData = emptyDomSignals(err.message);
  }

  // ── Article-level fallback ─────────────────────────────────────────────────
  // If the analysed URL is a homepage, bylines and comments are absent from the
  // DOM. Follow the first article link and run the same extractor there.
  if ((!domData.hasBylines || !domData.hasComments) && domData.firstArticleUrl) {
    let articlePage = null;
    try {
      articlePage = await page.context().newPage();
      await articlePage.goto(domData.firstArticleUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
      const articleSignals = await articlePage.evaluate(extractOpennessSignals, EXTRACT_ARGS);

      // Guard: skip section index pages (few words, no article body).
      // Only upgrade — never downgrade signals found on the homepage itself.
      if (articleSignals.wordCount >= 300) {
        if (!domData.hasBylines)  domData.hasBylines  = articleSignals.hasBylines;
        if (!domData.hasComments) domData.hasComments = articleSignals.hasComments;
      }
    } catch {
      // Article fetch failed — keep homepage signals as-is
    } finally {
      if (articlePage) { try { await articlePage.close(); } catch {} }
    }
  }

  // ── Probe overrides (server-side HTTP results, bypass bot-protection) ────────
  upgradeDomSignals(domData, probeData);

  return scoreOpenness(domData, trackers);
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function _clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

function scoreOpenness(dom, trackers) {

  // ── Dimension 1: Access (35%) ─────────────────────────────────────────────
  // Is journalism freely available to all, or gated behind money or data?
  let accessScore = 100;
  let wallType    = 'none';
  let wallSignals = [];

  if (dom.paywallEls.length > 0 || dom.hardPaywall.length >= 1) {
    wallType    = 'hard';
    wallSignals = dom.hardPaywall;
    accessScore -= 60;
  } else if (dom.meteredPaywall.length >= 1) {
    wallType    = 'metered';
    wallSignals = dom.meteredPaywall;
    accessScore -= 30; // Legitimate but restricts access
  } else if (dom.regWall.length >= 1) {
    wallType    = 'registration';
    wallSignals = dom.regWall;
    accessScore -= 18; // Free, but trades data for access
  }

  // ── Dimension 2: Participation & Transparency (35%) ───────────────────────
  // Does the publication create infrastructure for reader participation and
  // editorial accountability, or does it publish into a void?
  let participationScore = 0;
  const participationSignals = [];

  const add = (pts, id, label, note, positive = true) => {
    participationScore += pts;
    participationSignals.push({ id, label, positive, note });
  };
  const miss = (id, label, note) =>
    participationSignals.push({ id, label, positive: false, note });

  if (dom.hasRss)
    add(18, 'rss',         'RSS Feed',              'Open syndication: readers subscribe without algorithmic intermediation');
  else
    miss('no_rss',         'No RSS Feed',            'Readers must rely on algorithms or platform notifications to follow coverage');

  if (dom.hasBylines)
    add(16, 'bylines',     'Author Bylines',         'Journalism is attributed to named, accountable humans');
  else
    miss('no_bylines',     'No Visible Bylines',     'Articles lack attributed authorship — obscures accountability');

  if (dom.hasComments)
    add(12, 'comments',    'Reader Comments',        'Participation infrastructure: readers can respond to coverage');

  if (dom.hasCorrections)
    add(14, 'corrections', 'Corrections Policy',     'Editorial accountability: visible mechanism for factual corrections');
  else
    miss('no_corrections', 'No Corrections Link',    'No visible mechanism for editorial accountability or factual corrections');

  if (dom.hasContact)
    add(10, 'contact',     'Contact / Letters',      'Readers can reach the newsroom directly');

  if (dom.hasEditorialPolicy)
    add(12, 'editorial',   'Editorial Standards',    'Stated public commitment to journalistic values and ethics');
  else
    miss('no_editorial',   'No Editorial Standards Link', 'No visible public statement of journalistic standards');

  if (dom.hasCreativeCommons)
    add(10, 'cc_license',  'Open Licensing (CC)',    'Content can be shared and built upon beyond the paywall');

  if (dom.altRatio > 0.7)
    add(5,  'alt_text',    'Image Alt Text',         `${Math.round(dom.altRatio * 100)}% of images accessible to screen readers`);
  else
    miss('poor_alt_text',  'Poor Image Accessibility', `Only ${Math.round(dom.altRatio * 100)}% of images have alt text`);

  if (dom.hasMain)
    add(3,  'landmarks',   'ARIA Landmarks',         'Semantic HTML structure aids navigation for all readers');

  participationScore = Math.min(100, participationScore);

  // ── Dimension 3: AI Editorial Infrastructure (30%) ───────────────────────
  // To what degree are editorial decisions — what readers see, which headline
  // they read, whether they hit a paywall — made by algorithmic systems
  // rather than editorial judgment?
  let aiScore  = 100;
  const aiSignals = [];

  const hasAlgoRecs = trackers.some(t =>
    t.name.includes('Taboola') || t.name.includes('Outbrain') || t.name.includes('Nativo')
  );
  const hasPersonalisation = trackers.some(t =>
    AI_EDITORIAL_NAMES.some(n => t.name.includes(n)) &&
    !t.name.includes('Taboola') && !t.name.includes('Outbrain')
  );
  const hasAiPaywall = trackers.some(t =>
    t.name.includes('Piano') || t.name.includes('Zephr') || t.name.includes('Zuora') ||
    t.category === 'editorial_ai'
  );
  const hasHeadlineTesting = trackers.some(t => t.category === 'ab_testing');
  const hasEditorialAnalytics = trackers.some(t => t.category === 'editorial_analytics');

  if (hasAlgoRecs) {
    aiScore -= 35;
    aiSignals.push({
      id: 'algo_recs', severity: 'high',
      label: 'Algorithmic Content Recommendations',
      note: 'Taboola/Outbrain-style "Recommended" widgets determine what readers see next — editorial curation replaced by engagement maximisation, typically surfacing the most sensational or emotionally triggering content.',
    });
  }
  if (hasPersonalisation) {
    aiScore -= 22;
    aiSignals.push({
      id: 'personalisation', severity: 'high',
      label: 'AI Personalisation Engine',
      note: 'Content presentation is dynamically adjusted per reader profile. No two readers see the same editorial environment — the publication becomes a different newspaper for every person.',
    });
  }
  if (hasAiPaywall) {
    aiScore -= 18;
    aiSignals.push({
      id: 'ai_paywall', severity: 'medium',
      label: 'Predictive Paywall (Piano / Zephr)',
      note: 'A machine-learning model decides when to trigger the subscription wall based on each reader\'s predicted propensity to pay — different readers face different barriers to the same information.',
    });
  }
  if (hasHeadlineTesting) {
    aiScore -= 15;
    aiSignals.push({
      id: 'headline_testing', severity: 'medium',
      label: 'Headline A/B Testing',
      note: 'Different readers see different headlines for the same story. Click-rate metrics determine which version "wins", gradually shifting editorial voice toward engagement optimisation over clarity or accuracy.',
    });
  }
  if (dom.hasAlgoWidgets && !hasAlgoRecs) {
    aiScore -= 12;
    aiSignals.push({
      id: 'algo_widgets', severity: 'medium',
      label: 'Algorithmic Recommendation Widgets',
      note: 'Recommendation widgets detected in page DOM — adjacent content is surfaced algorithmically rather than through editorial curation.',
    });
  }
  if (hasEditorialAnalytics && !hasHeadlineTesting) {
    aiScore -= 8;
    aiSignals.push({
      id: 'editorial_analytics', severity: 'low',
      label: 'Real-Time Editorial Analytics (Chartbeat/Parse.ly)',
      note: 'Real-time performance dashboards make article metrics visible to editors while they work — research shows this subtly shifts commissioning and headline decisions toward traffic maximisation.',
    });
  }
  if (dom.aiDisclosures.length > 0) {
    aiSignals.push({
      id: 'ai_disclosure', severity: 'info',
      label: 'AI Content Disclosure Present',
      note: `Site discloses AI-generated or AI-assisted content: "${dom.aiDisclosures[0]}"`,
    });
  }
  if (aiSignals.length === 0) {
    aiSignals.push({
      id: 'no_ai_detected', severity: 'positive',
      label: 'No AI Editorial Systems Detected',
      note: 'No algorithmic recommendation, personalisation, or AI paywall systems found.',
    });
  }

  aiScore = Math.max(0, aiScore);

  // ── Composite Openness Score ──────────────────────────────────────────────
  const overall = _clamp(
    accessScore        * 0.35 +
    participationScore * 0.35 +
    aiScore            * 0.30
  );

  return {
    overall,
    dimensions: {
      access:        _clamp(accessScore),
      participation: _clamp(participationScore),
      aiEditorial:   _clamp(aiScore),
    },
    signals: {
      wallType,
      wallSignals,
      participationSignals,
      aiSignals,
      // Raw flags for quick access
      hasRss:          dom.hasRss,
      hasBylines:      dom.hasBylines,
      hasComments:     dom.hasComments,
      hasCorrections:  dom.hasCorrections,
      hasEditorialPolicy: dom.hasEditorialPolicy,
      accessibility: {
        lang:        dom.htmlLang,
        altPercent:  Math.round(dom.altRatio * 100),
        hasLandmarks: dom.hasMain,
      },
    },
  };
}

// ── Grade (shared with infrastructure scoring) ────────────────────────────────
function opennessGrade(score) {
  if (score >= 80) return { grade: 'A', label: 'Open & Accountable',  colorClass: 'green'  };
  if (score >= 65) return { grade: 'B', label: 'Partially Open',      colorClass: 'lime'   };
  if (score >= 45) return { grade: 'C', label: 'Restricted',          colorClass: 'amber'  };
  if (score >= 25) return { grade: 'D', label: 'Closed',              colorClass: 'orange' };
  return                   { grade: 'F', label: 'Opaque & Gated',      colorClass: 'red'    };
}

module.exports = { analyzeOpenness, scoreOpenness, opennessGrade };
