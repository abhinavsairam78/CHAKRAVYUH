import { createServer } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createStore, startCall, scammerTurn, decoyReply, endCall, publicCall, purgeCall } from './lib/calls.mjs';
import { seedHistory, REHEARSAL, syntheticVoice } from './lib/seed.mjs';
import { buildGraph } from './lib/graph.mjs';
import { renderDossier, feedExport } from './lib/dossier.mjs';
import { checkIfscLive } from './lib/ifsc.mjs';
import { llmEnabled, llmLabel, rephrase, reaction, reactionMode, localModelStatus, setDialogueMode, dialogueMode, recordDialogue, modelMetrics, prioritiseEvidence } from './lib/llm.mjs';
import { analyseCall, parseTranscript, reviewQueue } from './lib/analysis.mjs';
import { busyCalls, withCallLock } from './lib/turn-lock.mjs';
import { guard, STAGES } from './lib/persona.mjs';
import { CASE_STAGES, caseView, advanceCase, audit, activity, seedCases } from './lib/cases.mjs';
import { muleFeed, toCsv, lookup, liveHits, analytics } from './lib/intel.mjs';
import { playbooks } from './lib/playbooks.mjs';
import { simulateTelcoBatch } from './lib/simulate.mjs';

const root = resolve(import.meta.dirname, 'public');
const port = Number(process.env.PORT || 4310);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const storeContext = new AsyncLocalStorage();
const localStore = createStore(process.env.VERCEL ? null : process.env.CHAKRAVYUH_DATA_FILE || resolve(import.meta.dirname, 'data', 'store.json'));
const store = new Proxy(localStore, { get(target, key) { return (storeContext.getStore() || target)[key]; } });
const seedAll = (s) => {
  seedHistory(s);
  seedCases(s, buildGraph(s.data.calls));
};
if (!store.data.calls.length || !store.data.cases) store.reset(seedAll);

export async function withDemoStore(data, operation) {
  const isolated = createStore(null);
  if (data) {
    if (!Array.isArray(data.calls) || data.calls.length > 1500 || !Number.isInteger(data.nextId) || data.nextId < 1001) throw fail(400, 'Invalid browser demo state');
    Object.assign(isolated.data, data);
  } else isolated.reset(seedAll);
  return storeContext.run(isolated, async () => { const result = await operation(); return { ...result, state: isolated.data }; });
}

const clients = new Set();
let lastDossierMs = store.data.lastDossierMs ?? null;
const OFFICER = 'Demo officer (Cyber Cell)';

function ringsWithCases(graph) {
  return graph.rings.map((r) => ({ ...r, case: caseView(store, r) }));
}

function snapshot() {
  const calls = store.data.calls;
  const graph = buildGraph(calls);
  const rings = ringsWithCases(graph);
  const caseByRing = new Map(rings.map((r) => [r.id, r.case]));
  const done = calls.filter((c) => c.endedAt && !c.purged);
  const mules = muleFeed(graph, calls, caseByRing);
  const acted = rings.filter((r) => r.case.goldenHour.met !== null);
  return {
    kpis: {
      scammerMinutes: done.reduce((s, c) => s + (c.endedAt - c.startedAt), 0) / 60000,
      muleIdentifiers: mules.length,
      calls: done.length,
      linkedRings: rings.filter((r) => r.linked).length,
      callsInRings: rings.filter((r) => r.linked).reduce((s, r) => s + r.callIds.length, 0),
      numbers: new Set(done.map((c) => c.callerNumber).filter(Boolean)).size,
      dossierMs: lastDossierMs,
      moneyLost: 0,
      goldenHourMet: acted.length ? acted.filter((r) => r.case.goldenHour.met).length / acted.length : null,
      openCases: rings.filter((r) => !['FROZEN', 'CLOSED'].includes(r.case.status) && (r.upis.length || r.accounts.length)).length
    },
    calls: calls.map(publicCall).sort((a, b) => b.startedAt - a.startedAt),
    reviewQueue: reviewQueue(calls),
    graph: { ...graph, rings },
    mules,
    analytics: analytics(calls),
    activity: (store.data.activity || []).slice(0, 30),
    caseStages: CASE_STAGES,
    stages: STAGES,
    rehearsal: REHEARSAL.map(({ id, title, callerNumber, lines }) => ({ id, title, callerNumber, lines })),
    llm: llmLabel()
  };
}

let pending = null;
function broadcast(event = 'state', payload) {
  if (process.env.VERCEL) return;
  if (event === 'state' && !payload) {
    // Coalesce bursts (a telco batch ends many calls at once) into one snapshot.
    clearTimeout(pending);
    pending = setTimeout(() => {
      const data = JSON.stringify(snapshot());
      for (const res of clients) res.write(`event: state\ndata: ${data}\n\n`);
    }, 30);
    return;
  }
  const data = JSON.stringify(payload);
  for (const res of clients) res.write(`event: ${event}\ndata: ${data}\n\n`);
}

async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 128000) throw fail(413, 'Request is too large (128 KB maximum)');
    chunks.push(chunk);
  }
  try {
    const parsed = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw fail(400, 'Send a valid JSON object'); }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function findCall(id) {
  const call = store.data.calls.find((c) => c.id === id);
  if (!call) throw fail(404, 'No such call');
  return call;
}

function ringFor(graph, id) {
  return graph.rings.find((r) => r.id === id) || graph.rings.find((r) => r.callIds.includes(id));
}

function closedGraph() {
  return buildGraph(store.data.calls);
}

const routes = {
  'GET /api/health': (req, res) => json(res, 200, { status: 'ok', version: '0.2.0', uptimeSeconds: Math.round(process.uptime()), model: modelMetrics(), activeCalls: store.data.calls.filter((c) => !c.endedAt).length }),
  'GET /api/analysis/queue': (req, res) => json(res, 200, { queue: reviewQueue(store.data.calls) }),
  'GET /api/calls/:id/analysis': (req, res, id) => json(res, 200, analyseCall(findCall(id))),
  'POST /api/analysis': async (req, res) => {
    const { transcript, callId, useAI = false } = await body(req);
    const call = callId ? findCall(callId) : { turns: parseTranscript(transcript) };
    const analysis = analyseCall(call);
    if (analysis.unavailable) throw fail(410, analysis.reason);
    if (useAI === true) analysis.ranking = await prioritiseEvidence(analysis);
    json(res, 200, analysis);
  },
  'GET /api/state': (req, res) => json(res, 200, snapshot()),

  'GET /api/events': (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
  },

  'POST /api/calls': async (req, res) => {
    const { callerNumber, lang, channel, consent } = await body(req);
    const ch = channel === 'rehearsal' ? 'rehearsal' : 'citizen-merge';
    if (ch === 'citizen-merge' && consent !== true) throw fail(400, 'The citizen has to consent to recording before the decoy joins the call');
    if (callerNumber != null && (typeof callerNumber !== 'string' || callerNumber.length > 40)) throw fail(400, 'Invalid caller number');
    const call = startCall(store, { callerNumber, lang, channel: ch });
    // Caller ID check before the first word: has this number called the decoy before?
    const hits = call.callerNumber ? liveHits(closedGraph(), [{ type: 'phone', value: call.callerNumber }]) : [];
    if (hits.length) call.events.push({ t: 0, stage: 'HOOK', reason: `Known number: already in ring ${hits[0].ringId}` });
    activity(store, 'call', `${call.id} started (${call.channelLabel})${hits.length ? `; caller ID already in ring ${hits[0].ringId}` : ''}`, call.id);
    store.save();
    broadcast();
    json(res, 200, { call: publicCall(call), reply: call.turns[0].text, hits });
  },

  'GET /api/calls/:id': (req, res, id) => json(res, 200, publicCall(findCall(id))),

  'POST /api/calls/:id/turn': async (req, res, id) => withCallLock(id, async () => {
    const call = findCall(id);
    if (call.endedAt) throw fail(409, 'Call already ended');
    const { text } = await body(req);
    if (typeof text !== 'string' || !text.trim()) throw fail(400, 'Enter caller speech as text');
    if (text.length > 4000) throw fail(413, 'A caller turn is limited to 4,000 characters');
    const t = (Date.now() - call.startedAt) / 1000;
    const result = scammerTurn(call, text.trim(), t);
    let reply = result.reply;
    let worded = null;
    const modelStarted = performance.now();
    const modelWasEnabled = llmEnabled();
    if (reactionMode()) {
      const said = await reaction({ call, scammerText: text });
      if (said) worded = reply = guard(`${said} ${result.core}`, call);
    } else if (!result.intents.otp && !result.intents.remoteApp) {
      worded = await rephrase({ call, scammerText: text, templateReply: reply, reason: result.reason });
      if (worded) reply = guard(worded, call);
    }
    if (modelWasEnabled) recordDialogue(Boolean(worded), performance.now() - modelStarted);
    if (call.endedAt || call.purged) throw fail(409, 'Call is no longer active');
    decoyReply(call, reply, (Date.now() - call.startedAt) / 1000);
    const hits = liveHits(closedGraph(), result.fresh);
    for (const h of hits) {
      call.events.push({ t, stage: call.stage, reason: `Known mule: ${h.value} already seen in ring ${h.ringId} (${h.ringCalls} calls)` });
      activity(store, 'hit', `Live hit in ${call.id}: ${h.value} is already in ring ${h.ringId}`, h.ringId);
    }
    for (const f of result.fresh.filter((x) => x.type === 'upi' || x.type === 'account')) activity(store, 'mule', `${call.id} extracted ${f.type === 'upi' ? 'UPI' : 'account'} ${f.value}`, call.id);
    store.save();
    broadcast();
    json(res, 200, { reply, reason: result.reason, fresh: result.fresh, hits, worded: Boolean(worded), call: publicCall(call) });
  }),

  'POST /api/calls/:id/end': async (req, res, id) => withCallLock(id, async () => {
    const call = findCall(id);
    if (call.endedAt) throw fail(409, 'Call already ended');
    const { voiceprint, rehearsalSpeaker } = await body(req);
    if (voiceprint && (!Array.isArray(voiceprint.vector) || voiceprint.vector.length > 512 || !voiceprint.vector.every((n) => typeof n === 'number' && Number.isFinite(n)))) throw fail(400, 'Invalid voiceprint vector');
    const before = buildGraph(store.data.calls);
    const t0 = performance.now();
    endCall(call, { voiceprint: rehearsalSpeaker ? syntheticVoice(rehearsalSpeaker, call.id) : voiceprint });
    const graph = buildGraph(store.data.calls);
    const ring = ringFor(graph, call.id);
    renderDossier(ring, store.data.calls);
    const kase = caseView(store, ring);
    lastDossierMs = store.data.lastDossierMs = performance.now() - t0;
    call.dossierMs = lastDossierMs;
    const priorRing = new Set(ring.callIds.filter((c) => c !== call.id));
    const links = ring.evidence.filter((e) => e.callIds.includes(call.id) && e.callIds.some((c) => priorRing.has(c)));
    const merged = before.rings.filter((r) => r.callIds.some((c) => priorRing.has(c))).map((r) => r.id);
    const reveal = { callId: call.id, ringId: ring.id, linked: ring.linked, links, mergedFrom: merged, voice: graph.voiceByCall[call.id] || null, ringSize: ring.callIds.length, numbers: ring.callerNumbers.length, case: kase };
    activity(store, ring.linked ? 'link' : 'call', ring.linked ? `${call.id} joined ring ${ring.id} via ${links.map((l) => l.typeLabel.toLowerCase()).join(', ')}` : `${call.id} ended; new pattern recorded`, ring.id);
    store.save();
    broadcast();
    broadcast('reveal', reveal);
    json(res, 200, { call: publicCall(call), reveal });
  }),

  'POST /api/calls/:id/not-scam': async (req, res, id) => withCallLock(id, async () => {
    const call = findCall(id);
    const { reason } = await body(req);
    purgeCall(call, reason || 'Reviewer cleared it as not a scam');
    audit(store, OFFICER, `Erased content of ${call.id} (DPDP: not a scam)`);
    activity(store, 'purge', `${call.id} cleared as not a scam; recording and transcript erased`, call.id);
    store.save();
    broadcast();
    json(res, 200, { call: publicCall(call) });
  }),

  'POST /api/cases/:id/advance': async (req, res, id) => {
    const graph = closedGraph();
    const ring = ringFor(graph, id);
    if (!ring) throw fail(404, 'No such ring');
    const { status, ncrpAck, note } = await body(req);
    advanceCase(store, ring, { status, ncrpAck, note, actor: OFFICER });
    activity(store, 'case', `Case ${ring.id}: ${CASE_STAGES.find((s) => s.id === status).label}`, ring.id);
    store.save();
    broadcast();
    json(res, 200, { case: caseView(store, ring) });
  },

  'GET /api/settings': async (req, res) => json(res, 200, { dialogue: dialogueMode(), label: llmLabel(), local: await localModelStatus() }),

  'POST /api/settings': async (req, res) => {
    const { dialogue } = await body(req);
    const r = await setDialogueMode(dialogue);
    if (!r.ok) throw fail(409, r.error);
    audit(store, OFFICER, `Dialogue mode set to ${dialogueMode()}`);
    broadcast();
    json(res, 200, { dialogue: dialogueMode(), label: llmLabel() });
  },

  'GET /api/ifsc/:id': async (req, res, id) => json(res, 200, await checkIfscLive(id)),

  'GET /api/playbooks': (req, res) => json(res, 200, playbooks()),

  'GET /api/audit': (req, res) => json(res, 200, store.data.audit || []),

  'GET /api/v1/mules': (req, res) => {
    const graph = closedGraph();
    const rings = ringsWithCases(graph);
    audit(store, 'Bank API client (demo)', 'Pulled the mule-account feed');
    json(res, 200, { generatedAt: new Date().toISOString(), schema: 'chakravyuh.mule-feed.v1', mules: muleFeed(graph, store.data.calls, new Map(rings.map((r) => [r.id, r.case]))) });
  },

  'GET /api/v1/mules.csv': (req, res) => {
    const graph = closedGraph();
    const rings = ringsWithCases(graph);
    audit(store, OFFICER, 'Downloaded the mule-account feed (CSV)');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="chakravyuh-mule-feed.csv"' });
    res.end(toCsv(muleFeed(graph, store.data.calls, new Map(rings.map((r) => [r.id, r.case])))));
  },

  'GET /api/v1/lookup': (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams.get('q');
    const result = lookup(closedGraph(), store.data.calls, q);
    audit(store, OFFICER, `Lookup "${q}" (${result.hits.length} hit${result.hits.length === 1 ? '' : 's'})`);
    store.save();
    json(res, 200, result);
  },

  'POST /api/v1/telco/divert': async (req, res) => {
    const { count = 10 } = await body(req);
    const n = Math.max(1, Math.min(50, Number(count) || 10));
    const before = buildGraph(store.data.calls);
    const calls = simulateTelcoBatch(store, n);
    const graph = buildGraph(store.data.calls);
    const joined = calls.filter((c) => ringFor(graph, c.id)?.linked).length;
    activity(store, 'telco', `${n} flagged calls diverted by operators; ${joined} linked to known rings`, null);
    audit(store, 'Telco SIP gateway (simulated)', `Diverted ${n} flagged calls`);
    store.save();
    broadcast();
    json(res, 200, { diverted: n, linked: joined, ringsBefore: before.rings.filter((r) => r.linked).length, ringsAfter: graph.rings.filter((r) => r.linked).length, callIds: calls.map((c) => c.id) });
  },

  'POST /api/reset': (req, res) => {
    if (busyCalls.size || store.data.calls.some((c) => !c.endedAt)) throw fail(409, 'End active calls before resetting the demo');
    store.reset(seedAll);
    lastDossierMs = store.data.lastDossierMs = null;
    broadcast();
    json(res, 200, { ok: true });
  },

  'GET /dossier/:id': (req, res, id) => {
    const graph = closedGraph();
    const ring = ringFor(graph, id);
    if (!ring) throw fail(404, 'No such ring or call');
    audit(store, OFFICER, `Opened dossier for ${ring.id}`);
    store.save();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(renderDossier(ring, store.data.calls, Date.now(), caseView(store, ring)));
  },

  'GET /api/export/:id': (req, res, id) => {
    const graph = closedGraph();
    const ring = ringFor(graph, id.replace(/\.json$/, ''));
    if (!ring) throw fail(404, 'No such ring');
    audit(store, OFFICER, `Exported bank / I4C feed for ${ring.id}`);
    store.save();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="chakravyuh-${ring.id}.json"` });
    res.end(JSON.stringify(feedExport(ring, store.data.calls), null, 2));
  }
};

function match(method, pathname) {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const re = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(':id', '([^/]+)')}$`);
    const hit = pathname.match(re);
    if (hit) return [handler, hit[1] && decodeURIComponent(hit[1])];
  }
  return null;
}

export async function handleRequest(req, res) {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { throw fail(403, 'Invalid origin'); }
      if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) throw fail(403, 'Cross-origin requests are not allowed');
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { throw fail(400, 'Invalid URL'); }
    const route = match(req.method, pathname);
    if (route) return await route[0](req, res, route[1]);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (file !== root && !file.startsWith(root + sep)) throw fail(404, 'Not found');
    const info = await stat(file);
    if (!info.isFile()) throw fail(404, 'Not found');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch (err) {
    if (res.headersSent) return res.end();
    json(res, err.status || (err.code === 'ENOENT' ? 404 : 500), { error: err.message });
  }
}
if (!process.env.VERCEL) {
  const server = createServer(handleRequest).listen(port, '127.0.0.1', () => console.log(`Chakravyuh: http://127.0.0.1:${server.address().port}${llmEnabled() ? ` (dialogue model: ${llmLabel()})` : ''}`));
}
