'use strict';

// Extra request headers for one host, from FETCH_HOST_HEADERS.
//
// A site can sit behind a login (for example Cloudflare Access) and give Tare
// a service token. The setting is JSON mapping a host to the headers it needs;
// the host and its subdomains match. It is read on every call, never at load.
// A broken setting throws: silently sending nothing would look exactly like
// the site blocking Tare.
//
// In the browser the token is added per request through a route, never as a
// context-wide header, so the trackers and ad servers a page loads never see it.

const ENV = 'FETCH_HOST_HEADERS';

function hostHeaders(url) {
  const raw = (process.env[ENV] || '').trim();
  if (!raw) return {};
  let table;
  try { table = JSON.parse(raw); } catch { throw new Error(`${ENV} is not valid JSON`); }
  if (!table || typeof table !== 'object' || Array.isArray(table)) {
    throw new Error(`${ENV} must map hosts to headers`);
  }
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return {}; }
  for (const [key, extra] of Object.entries(table)) {
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)
        || !Object.values(extra).every(v => typeof v === 'string')) {
      throw new Error(`${ENV}: headers for ${JSON.stringify(key)} must be strings`);
    }
    const k = key.toLowerCase();
    if (host === k || host.endsWith('.' + k)) return { ...extra };
  }
  return {};
}

// route.continue(), adding the token only when this request's host needs one.
//
// Not route.continue({ headers }): Chromium keeps an overridden header on a
// redirect, so a 302 to another host would carry the token there
// (hostHeaders.test.js proves it). Instead this one hop is fetched with
// redirects off and handed back as-is; the browser follows any redirect as a
// new request, which comes back through this route and is judged by its own
// host.
async function continueWithHostHeaders(route) {
  const request = route.request();
  const extra = hostHeaders(request.url());
  if (Object.keys(extra).length === 0) return route.continue();
  const response = await route.fetch({ headers: { ...request.headers(), ...extra }, maxRedirects: 0 });
  return route.fulfill({ response });
}

module.exports = { hostHeaders, continueWithHostHeaders };
