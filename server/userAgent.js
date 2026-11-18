'use strict';

// What Tare sends as its User-Agent when it loads or probes a page.
// A browser string first, so sites serve Tare the page a reader gets; then
// Tare's own name, so a site that blocks unknown visitors at its edge can
// let Tare through by it.

const { version } = require('../package.json');

const TARE_TAG   = `Tare/${version}`;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + `(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ${TARE_TAG}`;

module.exports = { BROWSER_UA, TARE_TAG };
