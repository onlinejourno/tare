'use strict';

// DOM extraction for the Openness dimension — the in-page half of
// analyzeOpenness. extractOpennessSignals runs inside the browser via
// Playwright's page.evaluate (which serialises the function source), and in
// tests under jsdom on static HTML fixtures. It must therefore stay fully
// self-contained: no imports, no references to module scope — everything it
// needs arrives through its single argument.
//
// Regression note: page.evaluate accepts exactly ONE argument. This function
// previously lived inline and was invoked as evaluate(fn, hard, metered, reg) —
// Playwright throws "Too many arguments" on that call, so extraction silently
// fell back to all-false signals on every Headless run. Keep the single-object
// argument.

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

function extractOpennessSignals({ hardPaywallPhrases, meteredPaywallPhrases, registrationPhrases }) {
  // innerText is undefined under jsdom — fall back to textContent there.
  const bodyText = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
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
  const hardPaywall    = hardPaywallPhrases.filter(p => bodyText.includes(p));
  const meteredPaywall = meteredPaywallPhrases.filter(p => bodyText.includes(p));
  const regWall        = registrationPhrases.filter(p => bodyText.includes(p));

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
    wordCount,
    firstArticleUrl,
  };
}

/** The single-object argument extractOpennessSignals expects. */
const EXTRACT_ARGS = {
  hardPaywallPhrases:    HARD_PAYWALL_PHRASES,
  meteredPaywallPhrases: METERED_PAYWALL_PHRASES,
  registrationPhrases:   REGISTRATION_PHRASES,
};

/** All-false signal set — the fallback when extraction cannot run. */
function emptyDomSignals(errorMessage) {
  return {
    hasRss: false, hasCreativeCommons: false, hasBylines: false, hasComments: false,
    hasContact: false, hasCorrections: false, hasAbout: false, hasEditorialPolicy: false,
    htmlLang: '', altRatio: 0, hasMain: false, hasSkipLink: false,
    hasSearch: false, hasArchive: false,
    hardPaywall: [], meteredPaywall: [], regWall: [], paywallEls: [],
    aiDisclosures: [], hasAlgoWidgets: false, bodyLength: 0, wordCount: 0,
    firstArticleUrl: null,
    ...(errorMessage ? { error: errorMessage } : {}),
  };
}

module.exports = {
  extractOpennessSignals,
  emptyDomSignals,
  EXTRACT_ARGS,
  HARD_PAYWALL_PHRASES,
  METERED_PAYWALL_PHRASES,
  REGISTRATION_PHRASES,
};
