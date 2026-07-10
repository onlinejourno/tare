'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { validateUrl } = require('./ssrfGuard');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const { analyzeUrl, classifyRequests } = require('./analyzer');
const { scoreFromSignals } = require('./score');
const { saveAnalysis } = require('./db');
const { startSignalProbes, upgradeDomSignals } = require('./signalProbes');
const { democraticInfrastructureScore, scoreGrade, computeFlags } = require('./scoring');
const { opennessGrade } = require('./openness');
const { paywallGrade } = require('./paywallAudit');
const { generateRecommendations } = require('./recommendations');
const { writeReports } = require('./reportGenerator');
const jobs = require('./jobs');

const app = express();
app.set('trust proxy', 1); // one proxy (Fly) in front — trust it so req.ip is the real client
const PORT = process.env.PORT || 3000;
const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const MAX_CONCURRENT = 3;
const JOB_FILE_TTL_MS = 10 * 60 * 1000; // match jobs.js JOB_TTL_MS
let activeJobs = 0;

fs.mkdirSync(REPORTS_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// URL validation (SSRF guard) lives in ./ssrfGuard. Loopback check below gates
// admin-only routes (export) to localhost so they can't be triggered remotely.
function isLoopback(req) {
  const ip = req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Per-IP rate limit for the expensive endpoints (headless analysis, probes, scoring).
const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a few minutes and try again.' },
});

// Lighter per-IP limit for the cheap read endpoints (report download, job polling).
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a few minutes and try again.' },
});

// ── POST /api/analyze ────────────────────────────────────────────────────────
app.post('/api/analyze', analyzeLimiter, async (req, res) => {
  if (activeJobs >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Too many analyses in progress. Try again shortly.' });
  }

  let url;
  try {
    url = await validateUrl(req.body.url || '');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const jobId = uuidv4();
  jobs.createJob(jobId);
  res.json({ jobId });

  activeJobs++;
  // Fire-and-forget — do not await
  (async () => {
    try {
      const rawResult = await analyzeUrl(url, (stage, percent) => {
        jobs.emitProgress(jobId, stage, percent);
      });

      jobs.emitProgress(jobId, 'scoring', 92);

      const dis   = democraticInfrastructureScore(rawResult);
      const flags = computeFlags(rawResult);
      const open  = rawResult.openness    || { overall: 50, dimensions: {} };
      const pw    = rawResult.paywallAudit;

      const result = {
        ...rawResult,
        scores: {
          overall: dis.overall,
          overallGrade: scoreGrade(dis.overall),
          dimensions: dis.dimensions,
          dimensionGrades: Object.fromEntries(
            Object.entries(dis.dimensions).map(([k, v]) => [k, scoreGrade(v)])
          ),
          flags,
          // Openness Score — second panel
          openness: open.overall,
          opennessGrade: opennessGrade(open.overall),
          opennessDimensions: open.dimensions,
          opennessDimensionGrades: Object.fromEntries(
            Object.entries(open.dimensions || {}).map(([k, v]) => [k, opennessGrade(v)])
          ),
          // Paywall Quality Score (only present when a paywall platform is detected)
          ...(pw ? {
            paywallScore:      pw.score,
            paywallGrade:      paywallGrade(pw.score),
            paywallDimensions: pw.dimensions,
          } : {}),
          // Legacy aliases kept for report generator compatibility
          pageHealth: dis.dimensions.pageBloat,
          pageHealthGrade: scoreGrade(dis.dimensions.pageBloat),
          privacy: dis.dimensions.surveillance,
          privacyGrade: scoreGrade(dis.dimensions.surveillance),
        },
        recommendations: generateRecommendations(rawResult),
      };

      jobs.emitProgress(jobId, 'writing_reports', 95);
      writeReports(jobId, result);

      // Persist to SQLite index
      try {
        const cfBlocked = !!(rawResult.accessBlocked?.blocked);
        saveAnalysis(jobId, url, 'headless', result, cfBlocked);
      } catch (dbErr) {
        console.warn('[db] persist failed (non-fatal):', dbErr.message);
      }
      // Delete report files after TTL (jobs.js cleans in-memory state at same interval)
      setTimeout(() => {
        ['json', 'html'].forEach(ext =>
          fs.unlink(path.join(REPORTS_DIR, `${jobId}.${ext}`), () => {})
        );
      }, JOB_FILE_TTL_MS);

      jobs.emitComplete(jobId, result);
    } catch (err) {
      console.error('[analyzer error]', err);
      jobs.emitError(jobId, err);
    } finally {
      activeJobs--;
    }
  })();
});

// ── GET /api/progress/:jobId (Server-Sent Events) ───────────────────────────
app.get('/api/progress/:jobId', readLimiter, (req, res) => {
  const { jobId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // SSE comment as initial flush / keepalive
  res.write(': connected\n\n');

  const job = jobs.jobs.get(jobId);
  if (!job) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: 'Job not found' })}\n\n`);
    return res.end();
  }

  // If job already finished before client connected, send immediately
  if (job.status === 'complete') {
    res.write(`event: complete\ndata: ${JSON.stringify(job.result)}\n\n`);
    return res.end();
  }
  if (job.status === 'error') {
    res.write(`event: error\ndata: ${JSON.stringify({ message: job.error })}\n\n`);
    return res.end();
  }

  const emitter = jobs.emitters.get(jobId);
  if (!emitter) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: 'Emitter not found' })}\n\n`);
    return res.end();
  }

  const onProgress = (data) => res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
  const onComplete = (data) => { res.write(`event: complete\ndata: ${JSON.stringify(data)}\n\n`); res.end(); };
  const onError = (data) => { res.write(`event: error\ndata: ${JSON.stringify(data)}\n\n`); res.end(); };

  emitter.on('progress', onProgress);
  emitter.on('complete', onComplete);
  emitter.on('error', onError);

  req.on('close', () => {
    emitter.off('progress', onProgress);
    emitter.off('complete', onComplete);
    emitter.off('error', onError);
  });
});

// ── GET /api/result/:jobId (polling alternative to the SSE stream) ───────────
// SSE doesn't survive a proxy/rewrite reliably, so the OJDS front-end polls this
// instead. Returns the same job state the SSE stream carries.
app.get('/api/result/:jobId', readLimiter, (req, res) => {
  const job = jobs.jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({
    status: job.status,
    progress: job.progress,
    result: job.result || null,
    error: job.error || null,
  });
});

// ── GET /api/download/:jobId/:format ────────────────────────────────────────
app.get('/api/download/:jobId/:format', readLimiter, async (req, res) => {
  const { jobId, format } = req.params;

  // Strict UUID validation to prevent path traversal
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(jobId)) {
    return res.status(400).json({ error: 'Invalid job ID' });
  }
  if (!['json', 'html'].includes(format)) {
    return res.status(400).json({ error: 'Format must be json or html' });
  }

  // Belt-and-braces containment: the resolved path must stay inside REPORTS_DIR.
  const reportsRoot = path.resolve(REPORTS_DIR);
  const filePath = path.resolve(reportsRoot, `${jobId}.${format}`);
  if (!filePath.startsWith(reportsRoot + path.sep)) {
    return res.status(400).json({ error: 'Invalid job ID' });
  }
  try {
    await fs.promises.access(filePath);
  } catch {
    return res.status(404).json({ error: 'Report not found' });
  }

  res.download(filePath, `web-bloat-report.${format}`);
});

// ── GET /api/publications  (local index — all Publications, latest score) ─────
app.get('/api/publications', (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: 'The publications index is local-only.' });
  const { listPublications } = require('./db');
  try {
    res.json({ publications: listPublications() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/publications/:hostname  (history for one Publication) ────────────
app.get('/api/publications/:hostname', (req, res) => {
  if (!isLoopback(req)) return res.status(403).json({ error: 'The publications index is local-only.' });
  const { getPublicationHistory } = require('./db');
  try {
    const history = getPublicationHistory(req.params.hostname);
    if (!history.length) return res.status(404).json({ error: 'No analyses found for this publication.' });
    res.json({ hostname: req.params.hostname, runs: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/export  (trigger static JSON export) ────────────────────────────
app.post('/api/export', (req, res) => {
  if (!isLoopback(req)) {
    return res.status(403).json({ error: 'Export is restricted to localhost (run the export-index script instead).' });
  }
  const { exportAll } = require('./export');
  try {
    exportAll();
    res.json({ ok: true, message: 'Export written to /exports/' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /classify  (classify raw request URLs → tracker objects) ─────────────
// Claude collects all network request URLs from the real browser tab, POSTs them
// here, and receives back classified tracker objects ready for /score.
app.post('/classify', analyzeLimiter, (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls)) {
    return res.status(400).json({ error: 'body.urls must be an array of URL strings.' });
  }
  try {
    res.json({ trackers: classifyRequests(urls) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /score  (Live Browser Analysis — Claude MCP → Node scoring) ─────────
// Claude collects raw signals from a real browser tab via Chrome MCP tools,
// then POSTs them here. Node runs the same scoring functions as /api/analyze
// so scores are comparable across Headless and Live Browser modes. (ADR-0003)
//
// No job/SSE system — Claude calls this synchronously and receives scores back
// in the HTTP response. No Playwright is invoked; no outbound requests are made.
app.post('/score', analyzeLimiter, async (req, res) => {
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }
  if (typeof payload.url !== 'string' || !payload.url.startsWith('http')) {
    return res.status(400).json({ error: 'payload.url must be an http/https URL string.' });
  }

  try {
    // Optional server-side Signal Probes — upgrade domData before scoring
    // (same three-layer detection used in headless mode; bypasses Cloudflare)
    if (payload.runProbes) {
      // SSRF: the probe path fetches payload.url server-side — validate before any fetch.
      try {
        await validateUrl(payload.url);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const probeData = await startSignalProbes(payload.url);
      payload.domData = upgradeDomSignals(payload.domData || {}, probeData);
    }

    const result = scoreFromSignals(payload);

    // Persist to SQLite index
    const { v4: uuidv4 } = require('uuid');
    const runId = payload.runId || uuidv4();
    try {
      saveAnalysis(runId, payload.url, 'live-browser', result);
    } catch (dbErr) {
      console.warn('[db] persist failed (non-fatal):', dbErr.message);
    }

    res.json({ ok: true, runId, result });
  } catch (err) {
    console.error('[/score error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Web Bloat Checker running at http://localhost:${PORT}`);
});
