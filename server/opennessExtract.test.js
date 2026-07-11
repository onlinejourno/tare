'use strict';

// DOM extraction on static HTML fixtures via jsdom — the extraction half of
// the Openness dimension, previously an inline page.evaluate closure that was
// only exercisable in a live browser. The extractor is self-contained (it is
// serialised into the page by Playwright), so here we run it against a jsdom
// document by installing the fixture's globals for the duration of the call.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { extractOpennessSignals, emptyDomSignals, EXTRACT_ARGS } = require('./opennessExtract');

function extract(html, url = 'https://example.com/') {
  const dom = new JSDOM(html, { url });
  global.document = dom.window.document;
  global.window = dom.window;
  try {
    return extractOpennessSignals(EXTRACT_ARGS);
  } finally {
    delete global.document;
    delete global.window;
  }
}

describe('feeds', () => {
  test('RSS autodiscovery link tag', () => {
    assert.equal(extract('<head><link type="application/rss+xml" href="/feed"></head><body></body>').hasRss, true);
  });
  test('RSS via body link when autodiscovery absent', () => {
    assert.equal(extract('<body><a href="/rssfeeds/">RSS</a></body>').hasRss, true);
  });
  test('no feed signals', () => {
    assert.equal(extract('<body><a href="/news/">News</a></body>').hasRss, false);
  });
});

describe('bylines', () => {
  test('byline class element', () => {
    assert.equal(extract('<body><div class="byline">By Jane Reporter</div></body>').hasBylines, true);
  });
  test('JSON-LD author fallback when no DOM byline', () => {
    const html = `<body><script type="application/ld+json">
      {"@type":"NewsArticle","author":{"@type":"Person","name":"Jane Reporter"}}
    </script><p>story</p></body>`;
    assert.equal(extract(html).hasBylines, true);
  });
  test('empty byline element does not count', () => {
    assert.equal(extract('<body><div class="byline"> </div></body>').hasBylines, false);
  });
});

describe('participation and accountability links', () => {
  test('comments container detected', () => {
    assert.equal(extract('<body><div id="comments"></div></body>').hasComments, true);
  });
  test('contact, corrections, about, editorial links', () => {
    const html = `<body>
      <a href="/contact-us/">Contact</a>
      <a href="/corrections/">Corrections</a>
      <a href="/about-us/">About us</a>
      <a href="/editorial-standards/">Editorial standards</a>
    </body>`;
    const d = extract(html);
    assert.equal(d.hasContact, true);
    assert.equal(d.hasCorrections, true);
    assert.equal(d.hasAbout, true);
    assert.equal(d.hasEditorialPolicy, true);
  });
});

describe('paywall phrases', () => {
  test('hard paywall phrase in body text', () => {
    const d = extract('<body><p>This article is for subscribers only. Subscribe to read.</p></body>');
    assert.ok(d.hardPaywall.length >= 1);
  });
  test('metered phrase', () => {
    const d = extract('<body><p>You have 3 free articles left this month.</p></body>');
    assert.ok(d.meteredPaywall.length >= 1);
  });
  test('clean page has no wall phrases', () => {
    const d = extract('<body><p>Plain news story text.</p></body>');
    assert.deepEqual([d.hardPaywall, d.meteredPaywall, d.regWall], [[], [], []]);
  });
});

describe('first article link', () => {
  test('same-origin deep link found, cross-origin and shallow skipped', () => {
    const html = `<body><main>
      <a href="https://other.com/a/b/c">external</a>
      <a href="/section/">shallow</a>
      <a href="/india/politics/big-story-today">deep</a>
    </main></body>`;
    assert.equal(extract(html).firstArticleUrl, 'https://example.com/india/politics/big-story-today');
  });
  test('null when no candidate', () => {
    assert.equal(extract('<body><a href="/about/">about</a></body>').firstArticleUrl, null);
  });
});

describe('accessibility and misc', () => {
  test('lang, main landmark, alt ratio, word count', () => {
    const html = `<html lang="en"><body><main>
      <img src="a.jpg" alt="described"><img src="b.jpg" alt="also described">
      <p>${'word '.repeat(320)}</p>
    </main></body></html>`;
    const d = extract(html);
    assert.equal(d.htmlLang, 'en');
    assert.equal(d.hasMain, true);
    assert.equal(d.altRatio, 1);
    assert.ok(d.wordCount >= 300, `wordCount ${d.wordCount} should be >= 300`);
  });
  test('AI disclosure phrases and algo widgets', () => {
    const html = '<body><div class="taboola-feed"></div><p>This story was ai-generated.</p></body>';
    const d = extract(html);
    assert.equal(d.hasAlgoWidgets, true);
    assert.deepEqual(d.aiDisclosures, ['ai-generated']);
  });
});

describe('emptyDomSignals', () => {
  test('shape matches extractor output keys', () => {
    const extracted = extract('<body></body>');
    const empty = emptyDomSignals();
    assert.deepEqual(Object.keys(empty).sort(), Object.keys(extracted).sort());
  });
  test('carries the error message when given', () => {
    assert.equal(emptyDomSignals('boom').error, 'boom');
  });
});
