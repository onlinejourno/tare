'use strict';

// ── Anti-adblock phrase patterns (checked in page text after ad domains blocked) ─
const ANTIBLOCK_PHRASES = [
  'ad blocker detected', 'adblocker detected', 'adblock detected',
  'please disable your ad blocker', 'disable adblock', 'disable your ad blocker',
  'we noticed you', 'we detected an ad blocker',
  'turn off your ad blocker', 'whitelist our site', 'whitelist this site',
  'support us by disabling', 'ad-blocking software', 'ad blocking software',
  'you are using an ad blocker', 'looks like you have an ad block',
  'browser extension that blocks', 'ad blocker or similar',
  'it looks like you', 'ads appear to be blocked',
];

// Common ad-serving domains to simulate blocking (mirrors uBlock's core list)
const AD_BLOCK_DOMAINS = [
  'googlesyndication.com', 'doubleclick.net', 'googletagservices.com',
  'googleadservices.com', 'amazon-adsystem.com', 'adsystem.amazon.com',
  'pubmatic.com', 'rubiconproject.com', 'magnite.com', 'openx.net',
  'criteo.com', 'taboola.com', 'outbrain.com', 'moatads.com',
  'adsafeprotected.com', 'doubleverify.com', 'advertising.com',
  'adnxs.com', 'media.net', 'yieldmo.com', 'contextweb.com',
  'casalemedia.com', 'lijit.com', 'sovrn.com', '33across.com',
  'triplelift.com', 'sharethrough.com', 'indexexchange.com',
  'smartadserver.com', 'appnexus.com', 'turn.com', 'bidswitch.net',
  'adsrvr.org', 'sitescout.com', 'mediavine.com',
];

// ── Dark Pattern Detection ───────────────────────────────────────────────────
// Inspects the live consent banner DOM for manipulative design patterns.
// Reference: Computers & Security study finding 90% of popular websites use them.

async function detectDarkPatterns(page) {
  try {
    const result = await page.evaluate(() => {
      // Ordered list: more specific selectors first
      const consentSelectors = [
        '#onetrust-banner-sdk', '#onetrust-pc-sdk',
        '.qc-cmp2-container', '#sp-cc', '#sp-cc-root',
        '.fc-consent-root', '.fc-dialog-container',
        '#didomi-notice', '#didomi-popup',
        '.evidon-banner', '#evidon-banner',
        '[class*="cookie-notice"]', '[class*="consent-banner"]',
        '[id*="cookie-consent"]', '[id*="cookieconsent"]',
        '[class*="gdpr-banner"]', '[id*="gdpr"]',
        '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
        '[class*="cmp-"]', '[id*="cmp-"]',
        '#cookie-banner', '.cookie-banner',
        '.cookie-consent', '#cookie-consent',
        '[class*="privacy-manager"]', '[id*="privacy-manager"]',
      ];

      let banner = null;
      for (const sel of consentSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 50 && rect.height > 30) { banner = el; break; }
          }
        } catch {}
      }

      if (!banner) return { bannerFound: false };

      // Gather all interactive elements within the banner
      const allInteractive = [...banner.querySelectorAll(
        'button, [role="button"], input[type="button"], input[type="submit"], a'
      )];

      const elements = allInteractive.map(el => {
        const style = window.getComputedStyle(el);
        const rect  = el.getBoundingClientRect();
        const text  = (el.textContent || el.getAttribute('value') || '').trim().toLowerCase();
        return {
          text,
          tag:        el.tagName.toLowerCase(),
          bgColor:    style.backgroundColor,
          color:      style.color,
          fontSize:   parseFloat(style.fontSize) || 14,
          fontWeight: parseInt(style.fontWeight) || 400,
          hasBg:      style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent',
          hasBorder:  style.border !== 'none' && style.border !== '',
          visible:    rect.width > 0 && rect.height > 0,
          width:      rect.width,
          height:     rect.height,
        };
      }).filter(e => e.visible && e.text.length > 0 && e.text.length < 80);

      // Pre-ticked checkboxes for non-essential categories
      const allCheckboxes  = [...banner.querySelectorAll('input[type="checkbox"]')];
      const pretickedCount = allCheckboxes.filter(cb => cb.checked && !cb.disabled).length;
      const totalCheckboxes = allCheckboxes.length;

      // Banner text content — look for deceptive framing
      const bannerText = banner.textContent.toLowerCase();

      return { bannerFound: true, elements, pretickedCount, totalCheckboxes, bannerText };
    });

    if (!result || !result.bannerFound) {
      return { bannerFound: false, patterns: [], score: 100, summary: 'No consent banner found' };
    }

    const { elements, pretickedCount, totalCheckboxes, bannerText } = result;
    const patterns = [];

    // Term lists for button classification
    const REJECT_TERMS  = ['reject all', 'reject', 'decline all', 'decline', 'refuse all', 'refuse', 'no thanks', 'opt out', 'do not accept', 'do not agree'];
    const ACCEPT_TERMS  = ['accept all', 'accept cookies', 'accept', 'agree all', 'agree', 'allow all', 'allow cookies', 'allow', 'i agree', 'ok', 'okay', 'got it', 'continue', 'confirm', 'yes'];
    const MANAGE_TERMS  = ['manage', 'settings', 'preferences', 'customise', 'customize', 'more options', 'options', 'learn more', 'choose'];

    const isType = (el, terms) => terms.some(t => el.text === t || el.text.startsWith(t + ' '));

    const acceptEls = elements.filter(e => isType(e, ACCEPT_TERMS));
    const rejectEls = elements.filter(e => isType(e, REJECT_TERMS));
    const manageEls = elements.filter(e => isType(e, MANAGE_TERMS));
    // Reject links = reject as <a> rather than <button>
    const rejectLinks  = rejectEls.filter(e => e.tag === 'a');
    const rejectButtons = rejectEls.filter(e => e.tag !== 'a');

    // ── Pattern 1: No reject option at all ───────────────────────────────────
    if (rejectEls.length === 0 && acceptEls.length > 0) {
      patterns.push({
        id: 'no_reject_option',
        label: 'No Visible Reject Option',
        severity: 'critical',
        description: 'Consent banner shows no "Reject All" or "Decline" button. Accepting is the only clearly visible choice — a direct violation of GDPR\'s requirement for consent to be as easy to withdraw as to give.',
      });
    }

    // ── Pattern 2: Reject buried behind "manage preferences" ─────────────────
    // else if: Pattern 1 already captures the more severe "no reject at all" case;
    // Pattern 2 only applies when there IS no reject button AND no accept button either
    // (manage-only banner) — avoids double-flagging the same condition.
    else if (rejectEls.length === 0 && manageEls.length > 0) {
      patterns.push({
        id: 'reject_requires_extra_clicks',
        label: 'Declining Requires Extra Clicks',
        severity: 'high',
        description: 'No direct "Reject All" button on the primary banner. Refusing consent requires navigating through "Manage Preferences" — deliberate friction that exploits inertia bias.',
      });
    }

    // ── Pattern 3: Pre-ticked non-essential boxes ─────────────────────────────
    if (pretickedCount > 0) {
      patterns.push({
        id: 'preticked_boxes',
        label: `Pre-ticked Consent Boxes (${pretickedCount}/${totalCheckboxes})`,
        severity: 'critical',
        description: `${pretickedCount} non-essential cookie categor${pretickedCount > 1 ? 'ies are' : 'y is'} pre-ticked. GDPR Article 7 and Recital 32 explicitly prohibit this: valid consent requires an affirmative action — silence or pre-ticked boxes do not constitute consent.`,
      });
    }

    // ── Pattern 4: Reject only as a text link, accept as styled button ────────
    if (rejectButtons.length === 0 && rejectLinks.length > 0 && acceptEls.some(e => e.hasBg)) {
      patterns.push({
        id: 'reject_as_link_only',
        label: 'Reject Only Shown as Low-Prominence Link',
        severity: 'high',
        description: '"Accept" has a prominent styled button; declining requires finding a plain text link. The deliberate visual hierarchy exploits the "default effect" — readers follow the path of least visual resistance.',
      });
    }

    // ── Pattern 5: Button size/weight asymmetry ───────────────────────────────
    if (acceptEls.length > 0 && rejectEls.length > 0) {
      const accept = acceptEls[0];
      const reject = rejectEls[0];
      const sizeDiff = (accept.width * accept.height) - (reject.width * reject.height);
      const fontDiff = accept.fontSize - reject.fontSize;
      if (fontDiff > 1.5 || sizeDiff > 500) {
        patterns.push({
          id: 'visual_asymmetry',
          label: 'Accept Visually Dominant Over Decline',
          severity: 'medium',
          description: `The "accept" button is rendered ${fontDiff > 1.5 ? `${Math.round(fontDiff)}px larger` : 'physically larger'} than "decline". This exploits the visual salience heuristic: people tend to click what they see first and what appears most prominent.`,
        });
      }
    }

    // ── Pattern 6: "Legitimate interest" framing without off-switch ──────────
    if (bannerText.includes('legitimate interest') && rejectEls.length === 0) {
      patterns.push({
        id: 'legitimate_interest_no_opt_out',
        label: 'Legitimate Interest Without Opt-Out',
        severity: 'high',
        description: 'Banner invokes "legitimate interest" as a legal basis for processing without offering a straightforward opt-out. The ICO has stated legitimate interest cannot be used to override readers\' data rights.',
      });
    }

    // Score: deduct per pattern severity
    const deductions = { critical: 30, high: 18, medium: 8, low: 4 };
    const score = Math.max(0, 100 - patterns.reduce((s, p) => s + (deductions[p.severity] || 8), 0));

    return {
      bannerFound:        true,
      patterns,
      patternCount:       patterns.length,
      pretickedBoxes:     pretickedCount,
      hasNoRejectOption:  rejectEls.length === 0,
      acceptButtonCount:  acceptEls.length,
      rejectButtonCount:  rejectEls.length,
      score,
      summary: patterns.length === 0
        ? 'Consent interface appears fair — reject option clearly available'
        : `${patterns.length} dark pattern${patterns.length > 1 ? 's' : ''} detected in consent UI`,
    };

  } catch (err) {
    return {
      bannerFound: false, patterns: [], score: 100,
      summary: 'Could not analyse consent interface', error: err.message,
    };
  }
}

// ── Ad Blocker Wall Detection ────────────────────────────────────────────────
// Opens a second browser context with common ad domains blocked (simulating
// uBlock Origin), then checks whether the site punishes readers for it.
// The book's argument: blocking ads is a legitimate act of self-defence;
// penalising it is a political choice about who gets to access the news.

async function detectAdBlockerWall(url, browser) {
  let context = null;
  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();
    let blockedCount = 0;

    // Intercept: abort requests to known ad domains
    await page.route('**/*', (route) => {
      const reqUrl = route.request().url();
      const shouldBlock = AD_BLOCK_DOMAINS.some(d => reqUrl.includes(d));
      if (shouldBlock) { blockedCount++; route.abort(); }
      else route.continue();
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 22000 });
      await page.waitForTimeout(2500);
    } catch {}

    const detection = await page.evaluate((phrases) => {
      const bodyText = (document.body?.innerText || '').toLowerCase();
      const bodyHTML = (document.documentElement?.innerHTML || '').toLowerCase();

      const matchedPhrases = phrases.filter(p =>
        bodyText.includes(p) || bodyHTML.includes(p.replace(/['']/g, '\''))
      );

      // Known anti-adblock element selectors
      const antiblockSelectors = [
        '[class*="adblock"]', '[id*="adblock"]',
        '[class*="ad-block"]', '[id*="ad-block"]',
        '[class*="adblocker"]', '[id*="adblocker"]',
        '[data-ad-blocker]', '[data-adblock]',
        '.ad-blocker-wall', '#ad-blocker-wall',
        '[class*="noads"]', '[id*="noads"]',
      ];
      const selectorHits = antiblockSelectors.filter(sel => {
        try {
          const el = document.querySelector(sel);
          return el && el.getBoundingClientRect().width > 0;
        } catch { return false; }
      });

      // Full-page blocking overlay: high z-index + covers majority of viewport
      // Narrow selector to avoid iterating every DOM node on bloated pages.
      const overlays = [...document.querySelectorAll(
        'div, section, aside, nav, header, footer, [class*="overlay"], [class*="modal"], [id*="overlay"], [id*="modal"]'
      )].filter(el => {
        try {
          const style = window.getComputedStyle(el);
          const z = parseInt(style.zIndex) || 0;
          const rect = el.getBoundingClientRect();
          return z > 9999
            && (style.position === 'fixed' || style.position === 'absolute')
            && rect.width  > window.innerWidth  * 0.65
            && rect.height > window.innerHeight * 0.5;
        } catch { return false; }
      });

      return {
        matchedPhrases,
        selectorHits,
        overlayCount:   overlays.length,
        bodyLength:     bodyText.length,
        pageTitle:      document.title || '',
      };
    }, ANTIBLOCK_PHRASES);

    const phraseDetected   = detection.matchedPhrases.length > 0;
    const selectorDetected = detection.selectorHits.length > 0;
    const overlayDetected  = detection.overlayCount > 0;
    const hardBlock        = detection.bodyLength < 400 && blockedCount > 2;
    const wallDetected     = phraseDetected || selectorDetected || overlayDetected || hardBlock;

    let wallType = 'none';
    if (hardBlock)                             wallType = 'hard';
    else if (phraseDetected)                   wallType = 'message';
    else if (selectorDetected || overlayDetected) wallType = 'overlay';

    return {
      wallDetected,
      wallType,       // 'hard' | 'message' | 'overlay' | 'none'
      blockedRequests: blockedCount,
      matchedPhrases:  detection.matchedPhrases,
      selectorHits:    detection.selectorHits,
      summary: !wallDetected
        ? `No ad blocker wall detected (${blockedCount} ad requests blocked silently)`
        : wallType === 'hard'
          ? 'Hard block: content is hidden or removed when ads are blocked'
          : wallType === 'message'
          ? `Message wall: "${detection.matchedPhrases[0]}"`
          : 'Overlay wall: a blocking element appears when ads are intercepted',
    };

  } catch (err) {
    return {
      wallDetected: false, wallType: 'none', blockedRequests: 0,
      matchedPhrases: [], selectorHits: [],
      summary: 'Could not test ad blocker wall', error: err.message,
    };
  } finally {
    if (context) { try { await context.close(); } catch {} }
  }
}

module.exports = { detectDarkPatterns, detectAdBlockerWall };
