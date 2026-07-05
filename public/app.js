'use strict';

function $(id) { return document.getElementById(id); }
function show(id) { $(id)?.classList.remove('hidden'); }
function hide(id) { $(id)?.classList.add('hidden'); }

function fmt(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

function severityColor(s) {
  return { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#2563eb', positive: '#16a34a', info: '#6b7280' }[s] || '#6b7280';
}

const CAT_COLORS = {
  analytics: '#f59e0b', editorial_analytics: '#fb923c', audience_measurement: '#a78bfa',
  fingerprinting: '#dc2626', social_pixel: '#db2777', ssp: '#7c3aed',
  advertising: '#ef4444', identity_resolution: '#be123c', data_broker: '#991b1b',
  tag_manager: '#ec4899', ab_testing: '#f97316', editorial_ai: '#0891b2',
  social: '#8b5cf6', chat: '#3b82f6',
};

const CAT_LABELS = {
  analytics: 'Analytics', editorial_analytics: 'Editorial Analytics',
  audience_measurement: 'Audience Measurement', fingerprinting: 'Session Recording',
  social_pixel: 'Social Pixel', ssp: 'SSP / RTB', advertising: 'Advertising',
  identity_resolution: 'Identity Resolution', data_broker: 'Data Broker',
  tag_manager: 'Tag Manager', ab_testing: 'A/B Testing',
  editorial_ai: 'AI Editorial', social: 'Social Embed', chat: 'Chat Widget',
};

// Why each tracker category is rated at its severity level.
// Shown as a tooltip on the severity badge in the tracker list.
const SEV_REASONS = {
  fingerprinting:       'Critical — records every mouse movement, scroll, and click; can capture passwords and health queries',
  identity_resolution:  'Critical — builds persistent cross-device, cross-session reader profiles',
  data_broker:          'Critical — links browsing behaviour to offline purchase and demographic data',
  social_pixel:         'Critical — reports reading behaviour to social platforms, including for non-users',
  ssp:                  'Critical — receives reader identity in the programmatic RTB bid stream, broadcasting to ad buyers',
  advertising:          'High — retargeting and demand-side advertising; uses reader data for ad targeting',
  analytics:            'High — collects reader behaviour data; feeds the ad ecosystem when Google Analytics is used',
  editorial_analytics:  'Medium — real-time editorial metrics; still third-party, subtly shifts commissioning decisions',
  audience_measurement: 'Medium — third-party audience panel measurement required by ad buyers',
  tag_manager:          'Medium — loads arbitrary third-party scripts dynamically; opacity multiplier for tracking',
  ab_testing:           'Medium — tests different content versions on different readers without disclosure',
  editorial_ai:         'Medium — AI system shaping editorial decisions: recommendations, personalisation, AI paywall',
  chat:                 'Low — live support widget with data collection side effects',
  social:               'Low — social media embed; tracking is a side effect of content delivery',
};

const DIM_LABELS = {
  surveillance:            'Surveillance',
  adTechDepth:             'Ad-Tech Depth',
  consentPaywallIntegrity: 'Consent & Paywall Integrity',
  pageBloat:               'Page Bloat',
  openness:                'Openness',
  performance:             'Performance',
};

const STAGE_LABELS = {
  launching_browser:      'Launching browser…',
  starting_coverage:      'Starting code coverage…',
  navigating:             'Loading page…',
  auditing_consent:       'Auditing consent timing…',
  collecting_performance: 'Measuring performance…',
  collecting_coverage:    'Measuring unused code…',
  analyzing_assets:       'Analysing assets…',
  auditing_dark_patterns: 'Inspecting consent dark patterns…',
  testing_adblocker:      'Testing ad blocker response…',
  building_report:        'Building report…',
  analyzing_openness:     'Measuring openness & participation…',
  auditing_data_flow:     'Auditing data flows & cookies…',
  auditing_paywall:       'Auditing paywall implementation…',
  scoring:                'Calculating scores…',
  writing_reports:        'Writing report files…',
};

const OPEN_DIM_LABELS = {
  access:        'Access',
  participation: 'Participation',
  aiEditorial:   'AI Editorial',
};

const OPEN_DIM_ICONS = {
  access:        '🚪',
  participation: '🤝',
  aiEditorial:   '🤖',
};

// ── Gauge ─────────────────────────────────────────────────────────────────────

function drawGauge(canvasId, score) {
  const canvas = $(canvasId);
  if (!canvas) return;
  const ctx   = canvas.getContext('2d');
  const cx = 70, cy = 76, r = 56;
  const color = scoreColor(score);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  ctx.lineWidth = 14; ctx.strokeStyle = '#e5e7eb'; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI + (score / 100) * Math.PI);
  ctx.lineWidth = 14; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.stroke();
}

function bar(pct, color = '#3b82f6') {
  return `<div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,pct)}%;background:${color}"></div></div>`;
}

function badge(label, color) {
  return `<span class="badge" style="background:${color}">${esc(label)}</span>`;
}

// ── Render results ────────────────────────────────────────────────────────────

function renderResults(data, jobId) {
  const { scores, trackers, coverage, requests, assets, consentAudit, googleAttribution, rtbCascade, recommendations, darkPatterns, adBlockerWall, openness, dataFlow, paywallAudit } = data;

  // ── Bot-protection warning ─────────────────────────────────────────────────
  const blocked = data.meta?.accessBlocked;
  if (blocked) {
    show('access-blocked-section');
    const blocker = blocked.type === 'cloudflare' ? 'Cloudflare Bot Management' : 'a bot protection service';
    $('access-blocked-msg').textContent =
      `This publication uses ${blocker} that blocked the headless browser. ` +
      `The page served was "${blocked.title}" — not the actual article. ` +
      `Surveillance, tracker, and participation scores reflect a near-empty page and are unreliable. ` +
      `Scores marked with * should be treated with caution.`;
  }

  // ── Infrastructure Score ────────────────────────────────────────────────────
  const overall = scores.overall ?? 0;
  drawGauge('gauge-overall', overall);
  $('overall-val').textContent   = overall;
  $('overall-val').style.color   = scoreColor(overall);
  $('overall-grade').textContent = scoreLabel(overall);
  $('overall-grade').style.color = scoreColor(overall);
  $('overall-url').textContent   = data.meta?.url || '';

  const dims  = scores.dimensions || {};
  $('dim-grid').innerHTML = Object.entries(DIM_LABELS).map(([key, label]) => {
    const s = dims[key];
    if (s == null) return '';          // skip dimensions not returned by scorer
    const col = scoreColor(s);
    return `<div class="dim-row">
      <div class="dim-label">${esc(label)}</div>
      ${bar(s, col)}
      <div class="dim-score" style="color:${col}">${s}</div>
    </div>`;
  }).join('');

  // ── Openness Score ──────────────────────────────────────────────────────────
  if (openness) {
    const ov  = openness.overall ?? 0;
    drawGauge('gauge-openness', ov);
    $('openness-val').textContent   = ov;
    $('openness-val').style.color   = scoreColor(ov);
    $('openness-grade').textContent = (scores.opennessGrade || {}).label || scoreLabel(ov);
    $('openness-grade').style.color = scoreColor(ov);

    const odims = openness.dimensions || {};
    $('openness-dim-grid').innerHTML = Object.entries(OPEN_DIM_LABELS).map(([key, label]) => {
      const s   = odims[key] ?? 0;
      const col = scoreColor(s);
      return `<div class="dim-row">
        <div class="dim-label">${OPEN_DIM_ICONS[key] || ''} ${esc(label)}</div>
        ${bar(s, col)}
        <div class="dim-score" style="color:${col}">${s}</div>
      </div>`;
    }).join('');
  }

  // Flags
  const flags = scores.flags || [];
  if (flags.length > 0) {
    show('flags-section');
    $('flags-list').innerHTML = flags.map(f => {
      const col = severityColor(f.severity);
      return `<div class="flag-item" style="border-color:${col};background:${col}12">
        <span class="flag-icon">${f.icon}</span>
        <div><div class="flag-label" style="color:${col}">${esc(f.label)}</div><div class="flag-note">${esc(f.note)}</div></div>
      </div>`;
    }).join('');
  }

  // RTB cascade
  if (rtbCascade && rtbCascade.count > 0) {
    show('rtb-section');
    const hb = rtbCascade.headerBiddingDetected;
    $('rtb-title').innerHTML = `⚡ RTB Cascade — ${rtbCascade.count} bid-stream requests to ${rtbCascade.uniqueParticipants} participants${hb ? ' <span class="badge" style="background:#7c3aed">Header Bidding</span>' : ''}`;
    const maxMs = Math.max(...rtbCascade.requests.map(r => (r.startMs || 0) + 50), 500);
    $('rtb-cascade').innerHTML = `<div class="rtb-list">${
      rtbCascade.requests.slice(0, 25).map(r => {
        const left = Math.round(((r.startMs || 0) / maxMs) * 100);
        const col  = CAT_COLORS[r.category] || '#6b7280';
        return `<div class="rtb-row">
          <div class="rtb-name" title="${esc(r.url)}">${esc(r.name)}</div>
          <div class="rtb-track">
            <div class="rtb-bar" style="left:${left}%;background:${col}"></div>
          </div>
          <div class="rtb-ms">${r.startMs !== null ? r.startMs + 'ms' : '—'}</div>
          ${badge(CAT_LABELS[r.category] || r.category, col)}
        </div>`;
      }).join('')
    }</div>`;
  }

  // Google attribution
  if (googleAttribution && googleAttribution.requestCount > 0) {
    show('google-section');
    const isDB = googleAttribution.isDoubleBind;
    $('google-stats').innerHTML = `
      <div class="google-grid">
        <div class="google-stat">
          <div class="google-num">${googleAttribution.requestPercent}%</div>
          <div class="google-lbl">of all requests</div>
          <div class="google-sub">${googleAttribution.requestCount} of ${googleAttribution.totalRequests}</div>
        </div>
        <div class="google-stat">
          <div class="google-num">${googleAttribution.bytesPercent}%</div>
          <div class="google-lbl">of transferred bytes</div>
          <div class="google-sub">${fmt(googleAttribution.bytes)}</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin:.75rem 0">
        ${(googleAttribution.products || []).map(p => badge(p, '#1d4ed8')).join('')}
      </div>
      ${isDB ? `<div class="double-bind-alert">⚠️ <strong>Google Double-Bind:</strong> Google's ad ecosystem requires these scripts AND penalises the resulting page slowness via Core Web Vitals.</div>` : ''}`;
  }

  // Consent timing
  if (consentAudit) {
    show('consent-section');
    const col = consentAudit.trackersFireBeforeConsent ? '#dc2626' : !consentAudit.consentBannerDetected ? '#ea580c' : '#16a34a';
    const msg = consentAudit.trackersFireBeforeConsent ? 'Trackers fire before consent banner renders — likely GDPR violation'
              : !consentAudit.consentBannerDetected    ? 'No consent banner detected despite active trackers'
              : 'Consent banner detected';
    $('consent-detail').innerHTML = `
      <div class="consent-status" style="border-color:${col};background:${col}12;color:${col}">${msg}</div>
      <div class="consent-table">
        <div class="ct-row"><span>CMP detected</span><span>${consentAudit.consentBannerDetected ? '✅ Yes' : '❌ No'}</span></div>
        ${consentAudit.cmpSelector ? `<div class="ct-row"><span>CMP selector</span><span class="mono">${esc(consentAudit.cmpSelector)}</span></div>` : ''}
        <div class="ct-row"><span>First 3rd-party request</span><span>${consentAudit.firstThirdPartyRequestMs !== null ? consentAudit.firstThirdPartyRequestMs + 'ms' : '—'}</span></div>
        <div class="ct-row"><span>Pre-consent 3rd-party fires</span><span style="color:${consentAudit.preConsentThirdPartyCount > 0 ? '#dc2626' : '#16a34a'};font-weight:700">${consentAudit.preConsentThirdPartyCount}</span></div>
      </div>`;
  }

  // Dark patterns
  if (darkPatterns) {
    show('dark-patterns-section');
    if (!darkPatterns.bannerFound) {
      $('dark-patterns-detail').innerHTML = `<div class="dp-status dp-neutral">⚪ No consent banner detected — dark pattern analysis not applicable</div>`;
    } else if (darkPatterns.patternCount === 0) {
      $('dark-patterns-detail').innerHTML = `<div class="dp-status dp-pass">✅ ${esc(darkPatterns.summary)}</div>`;
    } else {
      $('dark-patterns-detail').innerHTML = `
        <div class="dp-status dp-fail">🎭 ${esc(darkPatterns.summary)}</div>
        <div class="dp-list">${darkPatterns.patterns.map(p => {
          const col = severityColor(p.severity);
          return `<div class="dp-item" style="border-left-color:${col}">
            <div class="dp-label" style="color:${col}">${badge(p.severity, col)} ${esc(p.label)}</div>
            <div class="dp-desc">${esc(p.description)}</div>
          </div>`;
        }).join('')}</div>
        <div class="dp-meta">
          ${darkPatterns.acceptButtonCount > 0 ? `<span>Accept buttons: <strong>${darkPatterns.acceptButtonCount}</strong></span>` : ''}
          ${darkPatterns.rejectButtonCount >= 0 ? `<span>Reject options: <strong style="color:${darkPatterns.rejectButtonCount === 0 ? '#dc2626' : '#16a34a'}">${darkPatterns.rejectButtonCount}</strong></span>` : ''}
          ${darkPatterns.pretickedBoxes > 0 ? `<span style="color:#dc2626">Pre-ticked boxes: <strong>${darkPatterns.pretickedBoxes}</strong></span>` : ''}
        </div>`;
    }
  }

  // Ad blocker wall
  if (adBlockerWall) {
    show('adblock-section');
    if (!adBlockerWall.wallDetected) {
      $('adblock-detail').innerHTML = `
        <div class="dp-status dp-pass">✅ ${esc(adBlockerWall.summary)}</div>`;
    } else {
      const col = adBlockerWall.wallType === 'hard' ? '#dc2626' : '#ea580c';
      const icon = adBlockerWall.wallType === 'hard' ? '🚫' : '⚠️';
      $('adblock-detail').innerHTML = `
        <div class="dp-status dp-fail" style="border-color:${col};background:${col}12;color:${col}">
          ${icon} ${esc(adBlockerWall.summary)}
        </div>
        <div class="dp-meta" style="margin-top:.6rem">
          <span>Wall type: <strong>${esc(adBlockerWall.wallType)}</strong></span>
          <span>Ad requests blocked: <strong>${adBlockerWall.blockedRequests}</strong></span>
          ${adBlockerWall.matchedPhrases.length > 0 ? `<span>Trigger phrase: <em>"${esc(adBlockerWall.matchedPhrases[0])}"</em></span>` : ''}
        </div>
        <p class="dp-rights-note">Blocking ads is a legitimate act of self-defence against data harvesting. A site that restricts access to readers who exercise it is making a political choice about who deserves the news.</p>`;
    }
  }

  // ── Openness detail sections ───────────────────────────────────────────────
  if (openness && openness.signals) {
    const sig = openness.signals;

    // Access & Paywall
    show('access-section');
    const wt = sig.wallType || 'none';
    const wallColors = { hard: '#dc2626', metered: '#ea580c', registration: '#d97706', none: '#16a34a' };
    const wallLabels = {
      hard:         '🚫 Hard Paywall — subscription required to read',
      metered:      '📊 Metered Paywall — free article limit in effect',
      registration: '📋 Registration Wall — account required (free but data-traded)',
      none:         '✅ Open Access — no paywall or registration wall detected',
    };
    const wCol = wallColors[wt] || '#6b7280';
    $('access-detail').innerHTML = `
      <div class="dp-status" style="border-color:${wCol};background:${wCol}12;color:${wCol}">
        ${wallLabels[wt] || 'Unknown'}
      </div>
      ${sig.wallSignals && sig.wallSignals.length > 0 ? `
        <div class="dp-meta" style="margin-top:.5rem">
          Detected phrase: <em>"${esc(sig.wallSignals[0])}"</em>
        </div>` : ''}
      <div class="open-score-note" style="margin-top:.75rem">
        Access sub-score: <strong style="color:${scoreColor(openness.dimensions.access || 0)}">${openness.dimensions.access || 0}/100</strong>
        — ${(openness.dimensions.access || 0) >= 80 ? 'Freely available to all readers' : (openness.dimensions.access || 0) >= 50 ? 'Restricted but some free access exists' : 'Significant access barriers'}
      </div>`;

    // Participation & Transparency
    show('participation-section');
    const pSigs = sig.participationSignals || [];
    const positives = pSigs.filter(s => s.positive);
    const negatives = pSigs.filter(s => !s.positive);
    $('participation-detail').innerHTML = `
      <div class="open-signals-grid">
        <div class="open-col">
          <div class="open-col-head" style="color:#16a34a">✅ Present (${positives.length})</div>
          ${positives.map(s => `<div class="open-signal open-signal-pass" title="${esc(s.note)}">
            <strong>${esc(s.label)}</strong>
            <span class="open-signal-note">${esc(s.note)}</span>
          </div>`).join('') || '<div class="open-signal-none">None detected</div>'}
        </div>
        <div class="open-col">
          <div class="open-col-head" style="color:#dc2626">❌ Missing (${negatives.length})</div>
          ${negatives.map(s => `<div class="open-signal open-signal-fail" title="${esc(s.note)}">
            <strong>${esc(s.label)}</strong>
            <span class="open-signal-note">${esc(s.note)}</span>
          </div>`).join('') || '<div class="open-signal-none">Nothing missing — excellent</div>'}
        </div>
      </div>
      <div class="open-score-note" style="margin-top:.75rem">
        Participation sub-score: <strong style="color:${scoreColor(openness.dimensions.participation || 0)}">${openness.dimensions.participation || 0}/100</strong>
      </div>`;

    // AI Editorial Infrastructure
    show('ai-editorial-section');
    const aiSigs = sig.aiSignals || [];
    const sev2color = { high: '#dc2626', medium: '#d97706', low: '#6b7280', positive: '#16a34a', info: '#2563eb' };
    $('ai-editorial-detail').innerHTML = `
      <div class="dp-list">
        ${aiSigs.map(s => {
          const col = sev2color[s.severity] || '#6b7280';
          return `<div class="dp-item" style="border-left-color:${col}">
            <div class="dp-label" style="color:${col}">${badge(s.severity, col)} ${esc(s.label)}</div>
            <div class="dp-desc">${esc(s.note)}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="open-score-note" style="margin-top:.5rem">
        AI Editorial sub-score: <strong style="color:${scoreColor(openness.dimensions.aiEditorial || 0)}">${openness.dimensions.aiEditorial || 0}/100</strong>
        — ${(openness.dimensions.aiEditorial || 0) >= 80 ? 'Editorial decisions appear to be made by humans' : 'Algorithmic systems are shaping editorial choices'}
      </div>`;
  }

  // Data Flow Audit
  if (dataFlow) {
    show('data-flow-section');
    const { cookies: ck, idSyncCount, outboundSignals, dataDestinations, tagManagers, trackersBehind } = dataFlow;

    const SIGNAL_LABELS = {
      user_identifier: 'User identifier (uid/cid)',
      email:           'Email / hashed email',
      page_url:        'Full page URL',
      referrer:        'Referrer URL',
      device_info:     'Device / user-agent',
      location:        'Location co-ordinates',
    };
    const signalEntries = Object.entries(outboundSignals || {});

    // Cookie summary row
    const ckHtml = `
      <div class="df-metrics-row">
        <div class="df-metric">
          <div class="df-metric-val">${ck.total}</div>
          <div class="df-metric-lbl">Total cookies</div>
        </div>
        <div class="df-metric">
          <div class="df-metric-val" style="color:#2563eb">${ck.firstParty}</div>
          <div class="df-metric-lbl">First-party</div>
        </div>
        <div class="df-metric">
          <div class="df-metric-val" style="color:${ck.thirdParty > 0 ? '#ea580c' : '#16a34a'}">${ck.thirdParty}</div>
          <div class="df-metric-lbl">Third-party</div>
        </div>
        <div class="df-metric">
          <div class="df-metric-val" style="color:${ck.tracking > 0 ? '#dc2626' : '#16a34a'}">${ck.tracking}</div>
          <div class="df-metric-lbl">Tracking</div>
        </div>
        <div class="df-metric">
          <div class="df-metric-val" style="color:${ck.persistent > 0 ? '#d97706' : '#16a34a'}">${ck.persistent}</div>
          <div class="df-metric-lbl">Persistent (&gt;24h)</div>
        </div>
        <div class="df-metric">
          <div class="df-metric-val" style="color:${idSyncCount > 0 ? '#dc2626' : '#16a34a'}">${idSyncCount}</div>
          <div class="df-metric-lbl">ID sync requests</div>
        </div>
      </div>
      ${ck.longestCookie ? `<p class="df-cookie-note">Longest-lived cookie: <code>${esc(ck.longestCookie.name)}</code> on <code>${esc(ck.longestCookie.domain)}</code> — expires in <strong>${ck.longestCookie.days} days</strong></p>` : ''}
      ${idSyncCount > 0 ? `<p class="df-cookie-note" style="color:#dc2626">⚠ ${idSyncCount} identity synchronisation request${idSyncCount > 1 ? 's' : ''} detected — your browser ID is being matched across sites and ad networks</p>` : ''}`;

    // Outbound signals
    const signalsHtml = signalEntries.length > 0 ? `
      <h3 class="df-subhead">Outbound data signals in request URLs</h3>
      <div class="df-signals-row">
        ${signalEntries.map(([type, count]) => `
          <div class="df-signal-chip">
            <span class="df-signal-count">${count}×</span>
            <span class="df-signal-label">${esc(SIGNAL_LABELS[type] || type)}</span>
          </div>`).join('')}
      </div>` : '';

    // Tag manager chain
    const chainHtml = tagManagers.length > 0 ? `
      <h3 class="df-subhead">Tag manager loading chain</h3>
      <div class="df-chain">
        <div class="df-chain-node df-chain-mgr">${tagManagers.map(esc).join(', ')}</div>
        ${trackersBehind.length > 0 ? `<div class="df-chain-arrow">↓ loads ${trackersBehind.length} tracker${trackersBehind.length > 1 ? 's' : ''}</div>
        <div class="df-chain-trackers">${trackersBehind.map(n => `<span class="df-chain-chip">${esc(n)}</span>`).join('')}</div>` : ''}
      </div>` : '';

    // Data destinations
    const destHtml = dataDestinations.length > 0 ? `
      <h3 class="df-subhead">Data recipients — who receives what when you visit this page</h3>
      <div class="df-dest-list">
        ${dataDestinations.map(d => `
          <div class="df-dest-item">
            <div class="df-dest-header">
              <span class="df-dest-icon">${d.icon}</span>
              <strong>${esc(d.label)}</strong>
              <span class="df-dest-names">${d.trackers.map(esc).join(', ')}</span>
            </div>
            <ul class="df-receives">
              ${d.receives.map(r => `<li>${esc(r)}</li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>` : '';

    $('data-flow-detail').innerHTML = ckHtml + signalsHtml + chainHtml + destHtml;
  }

  // Paywall Quality Score
  if (paywallAudit && paywallAudit.detected) {
    show('paywall-section');
    const pw = paywallAudit;
    const pwScore = pw.score;
    const pwGrade = scores.paywallGrade || '';
    const pwColor = scoreColor(pwScore);

    const PW_DIM_LABELS = {
      transparency:  'Transparency',
      hygiene:       'Technical Hygiene',
      readerRespect: 'Reader Respect',
      performance:   'Performance',
    };
    const PW_DIM_ICONS = {
      transparency:  '👁️',
      hygiene:       '🔧',
      readerRespect: '🤝',
      performance:   '⚡',
    };

    // Score bubble
    $('paywall-score-bubble').innerHTML = `
      <div class="pw-score-num" style="color:${pwColor}">${pwScore}</div>
      <div class="pw-score-grade" style="color:${pwColor}">${esc(pwGrade)}</div>
      <div class="pw-score-platform">${esc(pw.platform || 'Paywall')}</div>`;

    // Dimension bars
    const dimBarsHtml = `
      <div class="pw-dims">
        ${Object.entries(pw.dimensions || {}).map(([k, v]) => `
          <div class="pw-dim-row">
            <span class="pw-dim-icon">${PW_DIM_ICONS[k] || ''}</span>
            <span class="pw-dim-label">${PW_DIM_LABELS[k] || k}</span>
            ${bar(v, scoreColor(v))}
            <span class="pw-dim-val" style="color:${scoreColor(v)}">${v}</span>
          </div>`).join('')}
      </div>`;

    // Signals row
    const sig = pw.signals || {};
    const paywallTypeLabel = { hard: 'Hard Paywall', metered: 'Metered', registration: 'Registration Wall', none: 'No wall detected' };
    const paywallTypeColor = { hard: '#dc2626', metered: '#d97706', registration: '#ea580c', none: '#16a34a' };
    const pwType = pw.paywallType || 'none';

    const signalsHtml = `
      <div class="df-metrics-row" style="margin-top:.75rem">
        <div class="df-metric">
          <div class="df-metric-val" style="color:${paywallTypeColor[pwType] || '#6b7280'}">${esc(paywallTypeLabel[pwType] || pwType)}</div>
          <div class="df-metric-lbl">Wall type</div>
        </div>
        <div class="df-metric">
          <div class="df-metric-val" style="color:${sig.totalPlatformCalls > 10 ? '#dc2626' : sig.totalPlatformCalls > 5 ? '#d97706' : '#16a34a'}">${sig.totalPlatformCalls || 0}</div>
          <div class="df-metric-lbl">Platform calls</div>
        </div>
        <div class="df-metric">
          <div class="df-metric-val" style="color:${sig.duplicateCallCount > 0 ? '#ea580c' : '#16a34a'}">${sig.duplicateCallCount || 0}</div>
          <div class="df-metric-lbl">Duplicate calls</div>
        </div>
        <div class="df-metric">
          <div class="df-metric-val" style="color:${sig.surveillanceCount > 0 ? '#dc2626' : '#16a34a'}">${sig.surveillanceCount || 0}</div>
          <div class="df-metric-lbl">Surveillance endpoints</div>
        </div>
        <div class="df-metric">
          <div class="df-metric-val" style="color:${sig.hasLoginLink ? '#16a34a' : '#ea580c'}">${sig.hasLoginLink ? '✓' : '✗'}</div>
          <div class="df-metric-lbl">Login path visible</div>
        </div>
        <div class="df-metric">
          <div class="df-metric-val" style="color:${sig.hasPricing ? '#16a34a' : '#ea580c'}">${sig.hasPricing ? '✓' : '✗'}</div>
          <div class="df-metric-lbl">Pricing visible</div>
        </div>
      </div>
      ${(sig.detectedSurveillance || []).length > 0 ? `
        <div class="df-subhead" style="margin-top:.75rem">Surveillance endpoints detected</div>
        <div class="df-signals-row">
          ${sig.detectedSurveillance.map(s => `<div class="df-signal-chip" style="background:#fee2e2;border-color:#fca5a5"><span class="df-signal-label" style="color:#991b1b">${esc(s)}</span></div>`).join('')}
        </div>` : ''}`;

    // Privacy / reader rights issues
    const issuesHtml = (pw.privacyIssues || []).length > 0 ? `
      <div class="df-subhead" style="margin-top:.75rem">Privacy &amp; reader rights concerns</div>
      <div class="df-dest-list">
        ${pw.privacyIssues.map(issue => {
          const col = { high: '#dc2626', medium: '#d97706', low: '#2563eb' }[issue.severity] || '#6b7280';
          return `<div class="df-dest-item" style="border-left:3px solid ${col}">
            <div class="df-dest-header">
              ${badge(issue.severity, col)}
              <strong style="color:#111827">${esc(issue.label)}</strong>
            </div>
            <p style="margin:.25rem 0 0;font-size:.8rem;color:#4b5563;line-height:1.55">${esc(issue.note)}</p>
          </div>`;
        }).join('')}
      </div>` : '';

    $('paywall-detail').innerHTML = dimBarsHtml + signalsHtml + issuesHtml;
  }

  // Summary stats
  $('summary-stats').innerHTML = [
    ['Total requests', requests.total],
    ['Third-party requests', `${requests.thirdPartyCount} (${requests.thirdPartyPercent}%)`],
    ['Total transferred', fmt(assets.totalTransferBytes)],
    ['Trackers detected', trackers.length],
    ['Unused JS', `${coverage.jsUnusedPercent}%`],
    ['Unused CSS', `${coverage.cssUnusedPercent}%`],
  ].map(([label, val]) => `<div class="stat-card"><div class="stat-val">${esc(String(val))}</div><div class="stat-lbl">${esc(label)}</div></div>`).join('');

  // Trackers
  $('tracker-heading').textContent = `Trackers detected (${trackers.length})`;
  if (trackers.length === 0) {
    $('tracker-list').innerHTML = '<p style="color:#6b7280;text-align:center;padding:1rem">No known trackers detected</p>';
  } else {
    const grouped = {};
    for (const t of trackers) {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push(t);
    }
    const groupsHtml = Object.entries(grouped).map(([cat, ts]) => {
      const col = CAT_COLORS[cat] || '#6b7280';
      return `<div class="tracker-group">
        <div class="tracker-group-header">${badge(CAT_LABELS[cat] || cat, col)} <span class="tracker-count">${ts.length}</span></div>
        ${ts.map(t => {
          const reason = SEV_REASONS[t.category] || `${t.severity} severity`;
          return `<div class="tracker-item">
            <span class="tracker-name">${esc(t.name)}</span>
            <span class="tracker-domain">${esc(t.hostname)}</span>
            <span class="tracker-sev" style="color:${severityColor(t.severity)}" title="${esc(reason)}">${t.severity}</span>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
    $('tracker-list').innerHTML = `
      <div class="tracker-col-header">
        <span class="tracker-col-name">Tracker</span>
        <span class="tracker-col-domain">Domain</span>
        <span class="tracker-col-sev">Severity <span class="tracker-col-hint">(hover for reason)</span></span>
      </div>
      ${groupsHtml}`;
  }

  // Recommendations
  if (recommendations && recommendations.length > 0) {
    show('recs-section');
    $('recs-heading').textContent = `Recommendations (${recommendations.length})`;
    $('recs-list').innerHTML = recommendations.map(r => {
      const col  = severityColor(r.severity);
      const alts = (r.alternatives || []).map(a =>
        `<div class="alt-item"><strong>${esc(a.name)}</strong>${a.type ? ` <span class="alt-type">[${a.type}]</span>` : ''} — ${esc(a.note || '')}</div>`
      ).join('');
      return `<div class="rec-card" style="border-color:${col}">
        <div class="rec-header">${badge(r.severity, col)} <strong>${esc(r.title)}</strong></div>
        <p class="rec-detail">${esc(r.detail)}</p>
        ${alts ? `<div class="rec-alts"><strong>Alternatives:</strong>${alts}</div>` : ''}
      </div>`;
    }).join('');
  }

  // JS Coverage
  const jsFiles = (coverage.jsFiles || []).filter(f => f.totalBytes > 0 && f.unusedPercent > 20)
    .sort((a, b) => b.unusedBytes - a.unusedBytes).slice(0, 12);
  if (jsFiles.length > 0) {
    show('coverage-section');
    $('coverage-heading').textContent = `JavaScript Coverage — ${coverage.jsUnusedPercent}% unused`;
    $('coverage-note').textContent    = `${fmt(coverage.jsUnusedBytes)} of ${fmt(coverage.jsTotalBytes)} JavaScript never executes on initial load. Most unused JS on news sites is ad-tech infrastructure.`;
    $('coverage-list').innerHTML = jsFiles.map(f => {
      const short = f.url.length > 65 ? '…' + f.url.slice(-62) : f.url;
      const col   = f.unusedPercent > 70 ? '#ef4444' : f.unusedPercent > 40 ? '#f59e0b' : '#22c55e';
      return `<div class="cov-row" title="${esc(f.url)}">
        <div class="cov-url">${esc(short)}</div>
        <div class="cov-bar">${bar(f.unusedPercent, col)}<div class="cov-pct">${f.unusedPercent}% unused · ${fmt(f.totalBytes)}</div></div>
      </div>`;
    }).join('');
  }

  // Downloads
  $('dl-html').href = `/api/download/${jobId}/html`;
  $('dl-json').href = `/api/download/${jobId}/json`;

  show('results-section');
}

// ── Form / SSE ────────────────────────────────────────────────────────────────

let currentJobId = null;

$('analyze-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('url-input').value.trim();
  if (!url) return;

  hide('results-section');
  hide('error-section');
  show('progress-section');
  $('analyze-btn').disabled = true;
  $('progress-fill').style.width = '0%';
  $('progress-stage').textContent = 'Starting analysis…';
  $('progress-pct').textContent   = '0%';

  try {
    const res  = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const body = await res.json();
    if (!res.ok || body.error) throw new Error(body.error || 'Server error');
    currentJobId = body.jobId;

    const evtSrc = new EventSource(`/api/progress/${body.jobId}`);

    evtSrc.addEventListener('progress', (ev) => {
      const { stage, percent } = JSON.parse(ev.data);
      $('progress-stage').textContent = STAGE_LABELS[stage] || stage;
      $('progress-pct').textContent   = `${percent}%`;
      $('progress-fill').style.width  = `${percent}%`;
    });

    evtSrc.addEventListener('complete', (ev) => {
      evtSrc.close();
      hide('progress-section');
      $('analyze-btn').disabled = false;
      renderResults(JSON.parse(ev.data), body.jobId);
    });

    evtSrc.addEventListener('error', (ev) => {
      evtSrc.close();
      hide('progress-section');
      $('analyze-btn').disabled = false;
      const msg = ev.data ? JSON.parse(ev.data).message : 'Analysis failed';
      $('error-msg').textContent = msg;
      show('error-section');
    });

    evtSrc.onerror = () => {
      evtSrc.close();
      hide('progress-section');
      $('analyze-btn').disabled = false;
      $('error-msg').textContent = 'Connection lost. Please try again.';
      show('error-section');
    };
  } catch (err) {
    hide('progress-section');
    $('analyze-btn').disabled = false;
    $('error-msg').textContent = err.message;
    show('error-section');
  }
});

$('retry-btn').addEventListener('click', () => {
  hide('error-section');
});
