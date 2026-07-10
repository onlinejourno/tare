'use strict';

const { upgradeDomSignals } = require('./signalProbes');

// ── Phrase lists (passed into page.evaluate to avoid closure serialisation) ───

const HARD_PAYWALL_PHRASES = [
  'subscribe to read', 'subscribe to continue', 'subscribers only',
  'this article is for subscribers', 'exclusive to subscribers',
  'subscription required', 'member-only content', 'premium article',
  'only available to subscribers', 'read the full article with a subscription',
  'become a subscriber', 'subscribe now to read',
];

const METERED_PAYWALL_PHRASES = [
  'articles remaining', 'free articles left', 'free article limit',
  'you have used', 'monthly free articles', "you've read your",
  'free reads remaining', 'reading limit', "you've reached your",
  'of your monthly free articles',
];

const REGISTRATION_PHRASES = [
  'sign in to read', 'log in to read', 'create a free account to continue',
  'register to read', 'free registration required', 'sign up to read more',
  'create an account to access', 'register for free',
];

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
    domData = await page.evaluate(
      (hardP, meteredP, regP) => {
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const allLinks = [...document.querySelectorAll('a[href]')].map(a => ({
          href: (a.href || '').toLowerCase(),
          text: (a.textContent || '').trim().toLowerCase(),
        }));

        // ── Feeds ──────────────────────────────────────────────────────────
        // Check both <link> autodiscovery tags AND body <a> links.
        // Many publishers (e.g. thehindu.com) omit autodiscovery tags but
        // expose RSS via body links or a dedicated /rssfeeds/ page link.
        const feedEls = [...document.querySelectorAll(
          'link[type="application/rss+xml"],'  +
          'link[type="application/atom+xml"],' +
          'link[rel="alternate"][type*="xml"]'
        )];
        const rssBodyLinks = [...document.querySelectorAll('a[href]')].filter(a => {
          const h = (a.href || '').toLowerCase();
          return h.includes('.rss') || h.includes('/rss') || h.includes('/feed')
              || h.includes('/feeder') || h.includes('rssfeeds') || h.endsWith('/feed/')
              || h.includes('atom.xml');
        });
        const hasRss = feedEls.length > 0 || rssBodyLinks.length > 0;

        // ── First article link (for article-level signal fallback) ──────────
        // If the analysed URL is a homepage, bylines and comments won't be
        // present. We extract the first article link here so the outer function
        // can open it in a new tab and check those signals there.
        const origin = window.location.origin;
        const contentRoot = document.querySelector('article, main, [role="main"]') || document;
        const firstArticleUrl = [...contentRoot.querySelectorAll('a[href]')]
          .map(a => a.href)
          .find(href => {
            try {
              const u = new URL(href);
              return u.origin === origin
                && u.pathname.split('/').filter(Boolean).length >= 3;
            } catch { return false; }
          }) || null;

        // ── Open licensing ──────────────────────────────────────────────────
        const hasCreativeCommons =
          allLinks.some(a => {
            try {
              const h = new URL(a.href).hostname;
              return h === 'creativecommons.org' || h.endsWith('.creativecommons.org');
            } catch { return false; }
          }) ||
          !!document.querySelector('[itemprop="license"],[property="dc:license"],[rel="license"]');

        // ── Bylines ─────────────────────────────────────────────────────────
        // Wide selector set covers: standard itemprop/rel, common class patterns,
        // and Indian publisher CMS variants (The Hindu, NDTV, TOI, HT, IE, etc.)
        const bylineSels = [
          // Standards
          '[itemprop="author"]', '[rel="author"]',
          // Class fragment matches
          '[class*="byline"]', '[class*="author-name"]', '[class*="author_name"]',
          '[class*="auth-nm"]', '[class*="auth_nm"]', '[class*="auth-name"]',
          '[class*="auth-wrp"]', '[class*="auth-unit"]', '[class*="auth-box"]',
          '[class*="article-author"]', '[class*="article_author"]',
          '[class*="story-author"]', '[class*="story_author"]',
          '[class*="reporter"]', '[class*="journalist"]',
          '[class*="correspondent"]', '[class*="contributor"]',
          '[class*="written-by"]', '[class*="writtenby"]',
          '[class*="article-info"]', '[class*="article_info"]',
          // Data attributes
          '[data-author]', '[data-byline]',
          // Simple class selectors
          '.author', '.authors', '.byline', '.bylines',
          // Schema.org microdata Person
          '[itemscope][itemtype*="Person"] [itemprop="name"]',
        ];
        const hasBylinesDom = bylineSels.some(s => {
          try { const el = document.querySelector(s); return el && el.textContent.trim().length > 1; }
          catch { return false; }
        });

        // JSON-LD author fallback — most reliable for structured publishers.
        // The Hindu, BBC, Guardian etc. embed Schema.org NewsArticle with author.
        let hasBylines = hasBylinesDom;
        if (!hasBylines) {
          try {
            const ldScripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
            hasBylines = ldScripts.some(s => {
              try {
                const data = JSON.parse(s.textContent);
                const items = Array.isArray(data) ? data : [data];
                return items.some(item => {
                  const author = item.author || item.creator;
                  if (!author) return false;
                  const authors = Array.isArray(author) ? author : [author];
                  return authors.some(a => (a.name || (typeof a === 'string' && a)).length > 1);
                });
              } catch { return false; }
            });
          } catch {}
        }

        // ── Reader participation ─────────────────────────────────────────────
        const commentSels = [
          '#comments','.comments','[class*="comment-section"]',
          '#disqus_thread','.fb-comments','[class*="reader-comment"]',
        ];
        const hasComments = commentSels.some(s => !!document.querySelector(s));

        // ── Accountability links ─────────────────────────────────────────────
        const hasContact = allLinks.some(a =>
          a.href.includes('/contact') || a.text === 'contact' ||
          a.text.includes('write to us') || a.text.includes('letters to')
        );
        const hasCorrections = allLinks.some(a =>
          a.href.includes('correction') || a.text.includes('correction') ||
          a.text.includes('clarification') || a.href.includes('errata')
        );
        const hasAbout = allLinks.some(a =>
          (a.href.includes('/about') && !a.href.includes('aboutus.google')) ||
          a.text === 'about us' || a.text === 'about' ||
          a.text.includes('our mission') || a.text.includes('who we are')
        );
        const hasEditorialPolicy = allLinks.some(a =>
          a.href.includes('/editorial') || a.text.includes('editorial standard') ||
          a.href.includes('/ethics') || a.text.includes('our journalism') ||
          a.href.includes('/values') || a.text.includes('ethics')
        );

        // ── Accessibility ────────────────────────────────────────────────────
        const htmlLang    = document.documentElement.getAttribute('lang') || '';
        const allImgs     = [...document.querySelectorAll('img:not([role="presentation"])')];
        const altCount    = allImgs.filter(i => i.getAttribute('alt') !== null && i.getAttribute('alt').trim().length > 0).length;
        const altRatio    = allImgs.length > 0 ? altCount / allImgs.length : 1;
        const hasMain     = !!document.querySelector('main,[role="main"]');
        const hasSkipLink = !!document.querySelector('a[href="#main"],a[href="#content"],a[href="#main-content"]');

        // ── Search / Archive ─────────────────────────────────────────────────
        const hasSearch = !!(
          document.querySelector('input[type="search"],[class*="search-input"],[id*="search"]')
        );
        const hasArchive = allLinks.some(a =>
          a.href.includes('/archive') || a.href.includes('/search') || a.text === 'archive'
        );

        // ── Paywall detection ────────────────────────────────────────────────
        const hardPaywall    = hardP.filter(p => bodyText.includes(p));
        const meteredPaywall = meteredP.filter(p => bodyText.includes(p));
        const regWall        = regP.filter(p => bodyText.includes(p));

        const paywallSels = [
          '[class*="paywall"]','[id*="paywall"]','.tp-modal','#tp-modal',
          '[class*="piano-"]','[id*="piano-"]','[class*="subscriber-wall"]',
          '[class*="subscription-wall"]','[class*="premium-gate"]','[class*="content-gate"]',
          '[class*="zephr"]','[id*="zephr"]',
        ];
        const paywallEls = paywallSels.filter(s => {
          try {
            const el = document.querySelector(s);
            return el && el.getBoundingClientRect().width > 0;
          } catch { return false; }
        });

        // ── AI content disclosure ─────────────────────────────────────────────
        const aiDisclosurePhrases = [
          'written by ai','generated by ai','ai-generated','ai assisted',
          'automated journalism','robot-written','ai-written','created with ai',
        ];
        const aiDisclosures = aiDisclosurePhrases.filter(p => bodyText.includes(p));

        // ── Algorithmic recommendation widget DOM presence ────────────────────
        const algoSels = [
          '[class*="taboola"]','[id*="taboola"]',
          '[class*="outbrain"]','[id*="outbrain"]',
          '[id*="rcm"]','[class*="recirculation"]',
          '[class*="content-recommendation"]',
        ];
        const hasAlgoWidgets = algoSels.some(s => {
          try { return !!document.querySelector(s); } catch { return false; }
        });

        return {
          hasRss, hasCreativeCommons, hasBylines, hasComments,
          hasContact, hasCorrections, hasAbout, hasEditorialPolicy,
          htmlLang, altRatio, hasMain, hasSkipLink, hasSearch, hasArchive,
          hardPaywall, meteredPaywall, regWall, paywallEls,
          aiDisclosures, hasAlgoWidgets,
          bodyLength: bodyText.length,
          firstArticleUrl,
        };
      },
      HARD_PAYWALL_PHRASES,
      METERED_PAYWALL_PHRASES,
      REGISTRATION_PHRASES
    );
  } catch (err) {
    domData = {
      hasRss: false, hasCreativeCommons: false, hasBylines: false, hasComments: false,
      hasContact: false, hasCorrections: false, hasAbout: false, hasEditorialPolicy: false,
      htmlLang: '', altRatio: 0, hasMain: false, hasSkipLink: false,
      hasSearch: false, hasArchive: false,
      hardPaywall: [], meteredPaywall: [], regWall: [], paywallEls: [],
      aiDisclosures: [], hasAlgoWidgets: false, bodyLength: 0,
      firstArticleUrl: null,
      error: err.message,
    };
  }

  // ── Article-level fallback ─────────────────────────────────────────────────
  // If the analysed URL is a homepage, bylines and comments are absent from the
  // DOM. Follow the first article link to get a real signal for both.
  if ((!domData.hasBylines || !domData.hasComments) && domData.firstArticleUrl) {
    let articlePage = null;
    try {
      articlePage = await page.context().newPage();
      await articlePage.goto(domData.firstArticleUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });

      const articleSignals = await articlePage.evaluate(() => {
        const wordCount = (document.body?.innerText || '').trim().split(/\s+/).filter(Boolean).length;
        // Guard: skip section index pages (few words, no article body)
        if (wordCount < 300) return { hasBylines: false, hasComments: false, tooShort: true };

        const bylineSels = [
          '[itemprop="author"]', '[rel="author"]',
          '[class*="byline"]', '[class*="author-name"]', '[class*="author_name"]',
          '[class*="auth-nm"]', '[class*="auth_nm"]', '[class*="auth-name"]',
          '[class*="auth-wrp"]', '[class*="auth-unit"]', '[class*="auth-box"]',
          '[class*="article-author"]', '[class*="story-author"]',
          '[class*="reporter"]', '[class*="journalist"]', '[class*="correspondent"]',
          '[class*="contributor"]', '[class*="written-by"]', '[class*="writtenby"]',
          '[data-author]', '[data-byline]', '.author', '.authors', '.byline',
          '[itemscope][itemtype*="Person"] [itemprop="name"]',
        ];
        let hasBylines = bylineSels.some(s => {
          try { const el = document.querySelector(s); return el && el.textContent.trim().length > 1; }
          catch { return false; }
        });
        // JSON-LD fallback
        if (!hasBylines) {
          try {
            hasBylines = [...document.querySelectorAll('script[type="application/ld+json"]')].some(s => {
              try {
                const d = JSON.parse(s.textContent);
                const items = Array.isArray(d) ? d : [d];
                return items.some(item => {
                  const a = item.author || item.creator;
                  if (!a) return false;
                  const authors = Array.isArray(a) ? a : [a];
                  return authors.some(x => (x.name || (typeof x === 'string' && x) || '').length > 1);
                });
              } catch { return false; }
            });
          } catch {}
        }
        const commentSels = [
          '#comments','.comments','[class*="comment-section"]',
          '#disqus_thread','.fb-comments','[class*="reader-comment"]',
        ];
        const hasComments = commentSels.some(s => !!document.querySelector(s));
        return { hasBylines, hasComments, tooShort: false };
      });

      // Only upgrade — never downgrade signals found on the homepage itself
      if (!domData.hasBylines)  domData.hasBylines  = articleSignals.hasBylines;
      if (!domData.hasComments) domData.hasComments = articleSignals.hasComments;
    } catch {
      // Article fetch failed — keep homepage signals as-is
    } finally {
      if (articlePage) { try { await articlePage.close(); } catch {} }
    }
  }

  // ── Probe overrides (server-side HTTP results, bypass bot-protection) ────────
  upgradeDomSignals(domData, probeData);

  return _scoreOpenness(domData, trackers);
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function _clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

function _scoreOpenness(dom, trackers) {

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

module.exports = { analyzeOpenness, opennessGrade };
