'use strict';

const fs   = require('fs');
const path = require('path');
const { dimensionLabel } = require('./scoring');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function scoreColor(s) {
  if (s >= 80) return '#16a34a';
  if (s >= 65) return '#65a30d';
  if (s >= 45) return '#d97706';
  if (s >= 25) return '#ea580c';
  return '#dc2626';
}

function scoreLabel(s) {
  if (s >= 80) return 'Reader-Respecting';
  if (s >= 65) return 'Moderate';
  if (s >= 45) return 'Concerning';
  if (s >= 25) return 'Exploitative';
  return 'Egregious';
}

function bar(pct, color = '#3b82f6', height = '10px') {
  return `<div style="background:#e5e7eb;border-radius:4px;height:${height};overflow:hidden">` +
    `<div style="background:${color};width:${Math.min(100, pct)}%;height:100%;border-radius:4px"></div></div>`;
}

function badge(label, color) {
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:9999px;font-size:.7rem;font-weight:700;white-space:nowrap">${escHtml(label)}</span>`;
}

function severityColor(s) {
  return { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#2563eb', positive: '#16a34a' }[s] || '#6b7280';
}

const CAT_COLORS = {
  analytics: '#f59e0b', editorial_analytics: '#fb923c', audience_measurement: '#a78bfa',
  fingerprinting: '#dc2626', social_pixel: '#db2777', ssp: '#7c3aed',
  advertising: '#ef4444', identity_resolution: '#be123c', data_broker: '#991b1b',
  tag_manager: '#ec4899', ab_testing: '#f97316', social: '#8b5cf6', chat: '#3b82f6',
};

const CAT_LABELS = {
  analytics: 'Analytics', editorial_analytics: 'Editorial Analytics',
  audience_measurement: 'Audience Measurement', fingerprinting: 'Session Recording',
  social_pixel: 'Social Pixel', ssp: 'SSP / RTB', advertising: 'Advertising',
  identity_resolution: 'Identity Resolution', data_broker: 'Data Broker',
  tag_manager: 'Tag Manager', ab_testing: 'A/B Testing', social: 'Social Embed', chat: 'Chat Widget',
};

// Dimension labels are owned by scoring.js (dimensionLabel). Only the report's
// own prose descriptions live here, keyed by the canonical dimension keys.
const DIM_DESCRIPTIONS = {
  surveillance:            'Depth and severity of tracking apparatus deployed against readers',
  adTechDepth:             'Participation in programmatic advertising / RTB ecosystem',
  consentPaywallIntegrity: 'Honesty at the consent and paywall gates (pre-consent fires, CMP quality, paywall transparency)',
  pageBloat:               'Material weight of the page — access barrier for mobile users',
  openness:                'Access, participation infrastructure, and degree of AI editorial control',
  performance:             'Actual loading speed and interactivity impact',
};

// Render one table row per dimension the scorer actually produced. Iterating the
// real dimensions object (not a hand-maintained key list) means a new or renamed
// dimension can never silently render as 0 or vanish from the report.
function dimensionRowsHtml(dims) {
  return Object.entries(dims || {}).map(([key, s]) => {
    const col = scoreColor(s);
    return `<tr>
      <td style="padding:.5rem .75rem;font-size:.85rem;font-weight:600;white-space:nowrap">${dimensionLabel(key)}</td>
      <td style="padding:.5rem .75rem;width:100%">
        ${bar(s, col, '12px')}
        <div style="font-size:.75rem;color:#6b7280;margin-top:3px">${DIM_DESCRIPTIONS[key] || ''}</div>
      </td>
      <td style="padding:.5rem .75rem;font-size:.9rem;font-weight:700;color:${col};white-space:nowrap">${s}/100</td>
    </tr>`;
  }).join('');
}

function gaugesvg(score) {
  const color = scoreColor(score);
  const pct   = score / 100;
  const angle = pct * 180;
  const rad   = (angle - 90) * (Math.PI / 180);
  const cx = 60, cy = 60, r = 50;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);
  const largeArc = angle > 180 ? 1 : 0;
  return `<svg width="120" height="70" viewBox="0 0 120 70">
    <path d="M10,60 A50,50 0 0,1 110,60" fill="none" stroke="#e5e7eb" stroke-width="10" stroke-linecap="round"/>
    <path d="M10,60 A50,50 0 ${largeArc},1 ${x.toFixed(2)},${y.toFixed(2)}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>
    <text x="60" y="58" text-anchor="middle" font-size="22" font-weight="700" fill="${color}">${score}</text>
  </svg>`;
}

function generateHtmlReport(data) {
  const { meta, scores, trackers, coverage, requests, assets, consentAudit, performanceMetrics, googleAttribution, rtbCascade, recommendations } = data;

  // ── Flags ────────────────────────────────────────────────────────────────────
  const flagsHtml = (scores.flags || []).map(f => {
    const col = severityColor(f.severity);
    return `<div style="display:flex;align-items:flex-start;gap:.5rem;padding:.6rem .75rem;border-radius:8px;background:${col}15;border-left:3px solid ${col};margin-bottom:.5rem">
      <span style="font-size:1rem;flex-shrink:0">${f.icon}</span>
      <div>
        <div style="font-weight:700;color:${col};font-size:.85rem">${escHtml(f.label)}</div>
        <div style="font-size:.8rem;color:#4b5563;margin-top:2px">${escHtml(f.note)}</div>
      </div>
    </div>`;
  }).join('');

  // ── Dimension score bars ──────────────────────────────────────────────────────
  const dimRows = dimensionRowsHtml(scores.dimensions);

  // ── RTB cascade ───────────────────────────────────────────────────────────────
  let rtbHtml = '';
  if (rtbCascade && rtbCascade.count > 0) {
    const maxMs  = Math.max(...rtbCascade.requests.map(r => (r.startMs || 0) + 50), 500);
    const rows   = rtbCascade.requests.slice(0, 30).map(r => {
      const left = Math.round(((r.startMs || 0) / maxMs) * 100);
      const w    = 3 + Math.round((50 / maxMs) * 100);
      const cat  = r.category;
      const col  = CAT_COLORS[cat] || '#6b7280';
      return `<tr>
        <td style="padding:.3rem .75rem;font-size:.75rem;color:#374151;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.url)}">${escHtml(r.name)}</td>
        <td style="padding:.3rem .75rem;width:100%;position:relative;min-width:200px">
          <div style="position:relative;height:14px;background:#f3f4f6;border-radius:3px">
            <div style="position:absolute;left:${left}%;width:${Math.min(w, 100 - left)}%;height:100%;background:${col};border-radius:3px;opacity:.85" title="${r.startMs}ms"></div>
          </div>
        </td>
        <td style="padding:.3rem .75rem;font-size:.75rem;white-space:nowrap;color:#6b7280">${r.startMs !== null ? r.startMs + 'ms' : '—'}</td>
        <td style="padding:.3rem .75rem">${badge(CAT_LABELS[cat] || cat, col)}</td>
      </tr>`;
    }).join('');

    rtbHtml = `
    <h2 style="font-size:1.1rem;font-weight:700;margin:1.5rem 0 .75rem;border-bottom:2px solid #f3f4f6;padding-bottom:.4rem">
      ⚡ RTB Cascade — ${rtbCascade.count} bid-stream requests to ${rtbCascade.uniqueParticipants} participants
      ${rtbCascade.headerBiddingDetected ? '<span style="background:#7c3aed;color:#fff;font-size:.75rem;padding:2px 10px;border-radius:9999px;margin-left:.5rem">Header Bidding</span>' : ''}
    </h2>
    <p style="font-size:.85rem;color:#6b7280;margin-bottom:.75rem">
      Each bar below represents one request to an ad-tech intermediary, timed from navigation start.
      In the book's governing case study, this is the ~100ms auction that broadcasts reader identity to every buyer simultaneously.
    </p>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f9fafb">
        <th style="padding:.4rem .75rem;text-align:left;font-size:.75rem;color:#6b7280">Participant</th>
        <th style="padding:.4rem .75rem;text-align:left;font-size:.75rem;color:#6b7280">Timeline</th>
        <th style="padding:.4rem .75rem;text-align:left;font-size:.75rem;color:#6b7280">Start</th>
        <th style="padding:.4rem .75rem;text-align:left;font-size:.75rem;color:#6b7280">Type</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  // ── Google attribution ────────────────────────────────────────────────────────
  let googleHtml = '';
  if (googleAttribution && googleAttribution.requestCount > 0) {
    const doublebind = googleAttribution.isDoubleBind
      ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:.75rem;margin-top:.75rem;font-size:.85rem">
          <strong>⚠️ Google Double-Bind Detected</strong><br>
          Google's advertising ecosystem requires these scripts and causes the resulting page slowness.
          Google's Core Web Vitals algorithm then penalises publishers for that slowness in search rankings.
          The same actor is on both sides of the constraint simultaneously.
        </div>` : '';

    googleHtml = `
    <h2 style="font-size:1.1rem;font-weight:700;margin:1.5rem 0 .75rem;border-bottom:2px solid #f3f4f6;padding-bottom:.4rem">
      🔍 Google Ecosystem Attribution
    </h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;margin-bottom:.75rem">
      <div style="background:#f9fafb;border-radius:8px;padding:.75rem;text-align:center">
        <div style="font-size:1.8rem;font-weight:700;color:#1d4ed8">${googleAttribution.requestPercent}%</div>
        <div style="font-size:.8rem;color:#6b7280">of all requests</div>
        <div style="font-size:.75rem;color:#9ca3af">${googleAttribution.requestCount} of ${googleAttribution.totalRequests}</div>
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:.75rem;text-align:center">
        <div style="font-size:1.8rem;font-weight:700;color:#1d4ed8">${googleAttribution.bytesPercent}%</div>
        <div style="font-size:.8rem;color:#6b7280">of transferred bytes</div>
        <div style="font-size:.75rem;color:#9ca3af">${fmt(googleAttribution.bytes)} of ${fmt(googleAttribution.totalBytes)}</div>
      </div>
    </div>
    <div style="font-size:.85rem;color:#374151;margin-bottom:.5rem"><strong>Google products present:</strong></div>
    <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.5rem">
      ${(googleAttribution.products || []).map(p => badge(p, '#1d4ed8')).join('')}
    </div>
    ${doublebind}`;
  }

  // ── Consent audit ─────────────────────────────────────────────────────────────
  let consentHtml = '';
  if (consentAudit) {
    const statusColor = consentAudit.trackersFireBeforeConsent ? '#dc2626' :
                        !consentAudit.consentBannerDetected    ? '#ea580c' : '#16a34a';
    const statusText  = consentAudit.trackersFireBeforeConsent ? 'Trackers fire before consent banner renders' :
                        !consentAudit.consentBannerDetected    ? 'No consent banner detected' : 'Consent banner detected';

    consentHtml = `
    <h2 style="font-size:1.1rem;font-weight:700;margin:1.5rem 0 .75rem;border-bottom:2px solid #f3f4f6;padding-bottom:.4rem">
      🛡️ Consent Timing Audit
    </h2>
    <div style="background:${statusColor}15;border-left:4px solid ${statusColor};border-radius:8px;padding:.75rem;margin-bottom:.75rem">
      <strong style="color:${statusColor}">${statusText}</strong>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:.85rem">
      <tr><td style="padding:.4rem .75rem;color:#6b7280">CMP detected</td><td style="padding:.4rem .75rem;font-weight:600">${consentAudit.consentBannerDetected ? '✅ Yes' : '❌ No'}</td></tr>
      ${consentAudit.cmpSelector ? `<tr><td style="padding:.4rem .75rem;color:#6b7280">CMP selector</td><td style="padding:.4rem .75rem;font-family:monospace;font-size:.8rem">${escHtml(consentAudit.cmpSelector)}</td></tr>` : ''}
      <tr><td style="padding:.4rem .75rem;color:#6b7280">First 3rd-party request</td><td style="padding:.4rem .75rem;font-weight:600">${consentAudit.firstThirdPartyRequestMs !== null ? consentAudit.firstThirdPartyRequestMs + 'ms after navigation' : '—'}</td></tr>
      <tr><td style="padding:.4rem .75rem;color:#6b7280">Pre-consent 3rd-party requests</td><td style="padding:.4rem .75rem;font-weight:600;color:${consentAudit.preConsentThirdPartyCount > 0 ? '#dc2626' : '#16a34a'}">${consentAudit.preConsentThirdPartyCount}</td></tr>
    </table>`;
  }

  // ── Performance ───────────────────────────────────────────────────────────────
  let perfHtml = '';
  if (performanceMetrics) {
    const pm = performanceMetrics;
    const lcpColor  = pm.lcp > 4000 ? '#dc2626' : pm.lcp > 2500 ? '#d97706' : '#16a34a';
    const tbtColor  = pm.tbt > 600  ? '#dc2626' : pm.tbt > 300  ? '#d97706' : '#16a34a';
    const ttfbColor = pm.ttfb > 1800? '#dc2626' : pm.ttfb > 800 ? '#d97706' : '#16a34a';
    perfHtml = `
    <h2 style="font-size:1.1rem;font-weight:700;margin:1.5rem 0 .75rem;border-bottom:2px solid #f3f4f6;padding-bottom:.4rem">
      ⚡ Performance Metrics
    </h2>
    <table style="width:100%;border-collapse:collapse;font-size:.85rem">
      ${pm.lcp  !== null ? `<tr><td style="padding:.4rem .75rem;color:#6b7280">LCP (Largest Contentful Paint)</td><td style="padding:.4rem .75rem;font-weight:700;color:${lcpColor}">${pm.lcp}ms</td><td style="padding:.4rem .75rem;color:#9ca3af;font-size:.8rem">${pm.lcp > 4000 ? 'Poor' : pm.lcp > 2500 ? 'Needs improvement' : 'Good'} (Core Web Vital)</td></tr>` : ''}
      ${pm.tbt  !== null ? `<tr><td style="padding:.4rem .75rem;color:#6b7280">TBT (Total Blocking Time)</td><td style="padding:.4rem .75rem;font-weight:700;color:${tbtColor}">${pm.tbt}ms</td><td style="padding:.4rem .75rem;color:#9ca3af;font-size:.8rem">${pm.tbt > 600 ? 'Poor' : pm.tbt > 300 ? 'Needs improvement' : 'Good'}</td></tr>` : ''}
      ${pm.ttfb !== null ? `<tr><td style="padding:.4rem .75rem;color:#6b7280">TTFB (Time to First Byte)</td><td style="padding:.4rem .75rem;font-weight:700;color:${ttfbColor}">${pm.ttfb}ms</td><td style="padding:.4rem .75rem;color:#9ca3af;font-size:.8rem">${pm.ttfb > 1800 ? 'Poor' : pm.ttfb > 800 ? 'Needs improvement' : 'Good'}</td></tr>` : ''}
      ${pm.fcp  !== null ? `<tr><td style="padding:.4rem .75rem;color:#6b7280">FCP (First Contentful Paint)</td><td style="padding:.4rem .75rem;font-weight:600">${pm.fcp}ms</td><td></td></tr>` : ''}
      ${pm.pageLoad !== null ? `<tr><td style="padding:.4rem .75rem;color:#6b7280">Full Page Load</td><td style="padding:.4rem .75rem;font-weight:600">${pm.pageLoad}ms</td><td></td></tr>` : ''}
    </table>`;
  }

  // ── Trackers table ────────────────────────────────────────────────────────────
  const trackerRows = trackers.length === 0
    ? '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:1rem">No known trackers detected</td></tr>'
    : trackers.map(t => {
      const col   = CAT_COLORS[t.category] || '#6b7280';
      const catLabel = CAT_LABELS[t.category] || t.category;
      const sevCol = severityColor(t.severity);
      return `<tr>
        <td style="padding:.5rem .75rem;font-weight:600;font-size:.85rem">${escHtml(t.name)}</td>
        <td style="padding:.5rem .75rem">${badge(catLabel, col)}</td>
        <td style="padding:.5rem .75rem">${badge(t.severity, sevCol)}</td>
        <td style="padding:.5rem .75rem;color:#6b7280;font-size:.8rem;font-family:monospace">${escHtml(t.hostname)}</td>
      </tr>`;
    }).join('');

  // ── JS coverage ───────────────────────────────────────────────────────────────
  const jsRows = (coverage.jsFiles || [])
    .filter(f => f.totalBytes > 0)
    .sort((a, b) => b.unusedBytes - a.unusedBytes)
    .slice(0, 15)
    .map(f => {
      const short = f.url.length > 70 ? '…' + f.url.slice(-67) : f.url;
      const col   = f.unusedPercent > 70 ? '#ef4444' : f.unusedPercent > 40 ? '#f59e0b' : '#22c55e';
      return `<tr>
        <td style="padding:.4rem .75rem;font-size:.75rem;color:#374151;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(f.url)}">${escHtml(short)}</td>
        <td style="padding:.4rem .75rem;text-align:right;font-size:.82rem;white-space:nowrap">${fmt(f.totalBytes)}</td>
        <td style="padding:.4rem .75rem;min-width:120px">${bar(f.unusedPercent, col)}<div style="font-size:.72rem;color:#6b7280;margin-top:2px">${f.unusedPercent}% unused</div></td>
      </tr>`;
    }).join('');

  // ── Recommendations ───────────────────────────────────────────────────────────
  const recHtml = (recommendations || []).map(r => {
    const col   = severityColor(r.severity);
    const alts  = (r.alternatives || []).map(a =>
      `<div style="padding:.4rem .5rem;margin-top:.3rem;background:#f9fafb;border-radius:6px;font-size:.82rem">
        <strong>${escHtml(a.name)}</strong>${a.type ? ` <span style="color:#9ca3af">[${a.type}]</span>` : ''} — ${escHtml(a.note || '')}
      </div>`
    ).join('');
    return `<div style="border-left:4px solid ${col};padding:.75rem 1rem;margin-bottom:.75rem;background:${col}08;border-radius:0 8px 8px 0">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem">
        ${badge(r.severity, col)}
        <strong style="font-size:.9rem">${escHtml(r.title)}</strong>
      </div>
      <p style="font-size:.83rem;color:#4b5563;margin:.3rem 0">${escHtml(r.detail)}</p>
      ${alts ? `<div style="margin-top:.5rem"><strong style="font-size:.8rem;color:#374151">Alternatives:</strong>${alts}</div>` : ''}
    </div>`;
  }).join('');

  const overallScore = scores.overall ?? 0;
  const overallColor = scoreColor(overallScore);
  const overallLabel = scoreLabel(overallScore);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Digital Mirror Report — ${escHtml(meta.url)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111827; line-height: 1.5; }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 1.5rem 1rem; }
  .card { background: #fff; border-radius: 12px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; }
  tr:hover td { background: #f9fafb; }
  h1 { font-size: 1.4rem; font-weight: 800; }
  h2 { font-size: 1.05rem; font-weight: 700; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="wrap">

  <!-- Header -->
  <div class="card">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap">
      <div>
        <div style="font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;font-weight:600;margin-bottom:.25rem">Digital Mirror — Democratic Infrastructure Report</div>
        <h1>${escHtml(meta.url)}</h1>
        <div style="color:#6b7280;font-size:.85rem;margin-top:.25rem">Analysed ${new Date(meta.analyzedAt).toUTCString()} · ${meta.durationMs ? Math.round(meta.durationMs / 1000) + 's scan' : ''}</div>
      </div>
      <div style="text-align:center;flex-shrink:0">
        ${gaugesvg(overallScore)}
        <div style="font-weight:800;color:${overallColor};font-size:1rem;margin-top:.25rem">${overallLabel}</div>
        <div style="font-size:.75rem;color:#6b7280">Democratic Infrastructure Score</div>
      </div>
    </div>
  </div>

  <!-- Flags -->
  ${(scores.flags || []).length > 0 ? `<div class="card"><h2 style="margin-bottom:.75rem">Findings at a Glance</h2>${flagsHtml}</div>` : ''}

  <!-- 5-dimension scores -->
  <div class="card">
    <h2 style="margin-bottom:.75rem">Five-Dimension Score Breakdown</h2>
    <table>${dimRows}</table>
  </div>

  <!-- RTB cascade -->
  ${rtbHtml ? `<div class="card">${rtbHtml}</div>` : ''}

  <!-- Google attribution -->
  ${googleHtml ? `<div class="card">${googleHtml}</div>` : ''}

  <!-- Consent audit -->
  ${consentHtml ? `<div class="card">${consentHtml}</div>` : ''}

  <!-- Performance -->
  ${perfHtml ? `<div class="card">${perfHtml}</div>` : ''}

  <!-- Trackers -->
  <div class="card">
    <h2 style="margin-bottom:.75rem">Trackers Detected (${trackers.length})</h2>
    <div style="overflow-x:auto">
    <table>
      <thead><tr style="background:#f9fafb">
        <th style="padding:.4rem .75rem;text-align:left;font-size:.75rem;color:#6b7280">Name</th>
        <th style="padding:.4rem .75rem;text-align:left;font-size:.75rem;color:#6b7280">Category</th>
        <th style="padding:.4rem .75rem;text-align:left;font-size:.75rem;color:#6b7280">Severity</th>
        <th style="padding:.4rem .75rem;text-align:left;font-size:.75rem;color:#6b7280">Domain</th>
      </tr></thead>
      <tbody>${trackerRows}</tbody>
    </table>
    </div>
  </div>

  <!-- JS Coverage -->
  ${jsRows ? `<div class="card">
    <h2 style="margin-bottom:.3rem">JavaScript Coverage — ${coverage.jsUnusedPercent}% unused</h2>
    <p style="font-size:.82rem;color:#6b7280;margin-bottom:.75rem">${fmt(coverage.jsUnusedBytes)} of ${fmt(coverage.jsTotalBytes)} never executes on initial page load. Most unused JS on news sites is ad-tech infrastructure.</p>
    <div style="overflow-x:auto"><table>
      <thead><tr style="background:#f9fafb">
        <th style="padding:.4rem .75rem;text-align:left;font-size:.75rem;color:#6b7280">Script</th>
        <th style="padding:.4rem .75rem;text-align:right;font-size:.75rem;color:#6b7280">Total</th>
        <th style="padding:.4rem .75rem;text-align:left;font-size:.75rem;color:#6b7280;min-width:140px">Unused</th>
      </tr></thead>
      <tbody>${jsRows}</tbody>
    </table></div>
  </div>` : ''}

  <!-- Summary stats -->
  <div class="card">
    <h2 style="margin-bottom:.75rem">Request Summary</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.75rem">
      <div style="background:#f9fafb;border-radius:8px;padding:.75rem;text-align:center">
        <div style="font-size:1.6rem;font-weight:700">${requests.total}</div>
        <div style="font-size:.8rem;color:#6b7280">Total requests</div>
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:.75rem;text-align:center">
        <div style="font-size:1.6rem;font-weight:700">${requests.thirdPartyCount}</div>
        <div style="font-size:.8rem;color:#6b7280">Third-party (${requests.thirdPartyPercent}%)</div>
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:.75rem;text-align:center">
        <div style="font-size:1.6rem;font-weight:700">${fmt(assets.totalTransferBytes)}</div>
        <div style="font-size:.8rem;color:#6b7280">Total transferred</div>
      </div>
      <div style="background:#f9fafb;border-radius:8px;padding:.75rem;text-align:center">
        <div style="font-size:1.6rem;font-weight:700">${trackers.length}</div>
        <div style="font-size:.8rem;color:#6b7280">Trackers</div>
      </div>
    </div>
  </div>

  <!-- Recommendations -->
  ${recommendations && recommendations.length > 0 ? `<div class="card">
    <h2 style="margin-bottom:.75rem">Recommendations (${recommendations.length})</h2>
    ${recHtml}
  </div>` : ''}

  <div style="text-align:center;color:#9ca3af;font-size:.8rem;padding:1rem 0">
    Generated by Digital Mirror · Tool v${meta.toolVersion || '2.0'} · Companion to <em>The Digital Mirror: Digital Journalism, Democratic Decline, and the Reckoning Ahead</em>
  </div>

</div>
</body>
</html>`;
}

function writeReports(jobId, data) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, `${jobId}.json`), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(REPORTS_DIR, `${jobId}.html`), generateHtmlReport(data));
}

module.exports = { writeReports, generateHtmlReport, dimensionRowsHtml };
