# Chakravyuh

AI scam-call decoy and fraud-ring intelligence. Founder's Code 2026, Cybersecurity & Digital Safety (Topic 2).

A citizen merges a suspicious call into the decoy number (or a telco diverts a flagged call). An AI persona plays the victim the scam expects, steers the caller to the payment step, and reads back the UPI ID and account so they are confirmed on the recording. Every call joins a graph that links calls through shared caller numbers, mule accounts, UPI IDs, voiceprints and honeytoken identities. Each ring gets a 1930 / NCRP complaint packet and bank freeze requests the moment a call ends, and a case board tracks them against the golden hour.

## Run

### Vercel browser demo

`vercel --prod` builds the static console and a stateless demo API. Each visitor's demo history is saved in their browser and sent with requests; it survives function restarts and remains separate from other visitors. Dossiers and CSV/JSON exports use that same browser session. Clearing browser storage resets its progress. This mode is for synthetic hackathon demonstrations, not shared operational records. The hosted version uses the playbook and local evidence rules; the laptop-only Ollama model requires `npm run start:ai` locally.

Vercel runs `node scripts/build-vercel.mjs`. No database or model keys are required for the hosted demo.

Requires Node.js 20 or newer. No packages, no API keys, works offline.

```powershell
cd chakravyuh
npm start
```

Open `http://127.0.0.1:4310` in **Microsoft Edge** (neural Indian voices, speech recognition). Chrome works with plainer voices. `npm test` runs the pipeline tests.

## The console

### New in 0.2: Investigation studio

Open **Investigation studio** from the sidebar. Select a call from the priority-sorted list, search by call ID/number/pattern, or paste/import a `.txt` transcript. Prefix dialogue with `Caller:` and `Decoy:`; unlabelled lines are treated as caller speech. Transcript previews are processed locally and are not saved to the call store.

The studio provides a review brief, caller-only identifier extraction, exact quoted signals with turn references, missing-evidence checks, a reviewer checklist, a SHA-256 source fingerprint, and a downloadable JSON analysis. Scores are transparent heuristics for triage, not calibrated probabilities or determinations of fraud. Keyword cues can also occur in legitimate conversations.

**Prioritize with local AI** asks the enabled Ollama model to select existing evidence IDs. Unknown IDs or invalid output trigger an explicit deterministic fallback. Model text cannot add or replace evidence. Enable the installed model in the studio, or start with `npm run start:ai`. AI ranking has a 12-second timeout. English dialogue supports short local-model reactions; Hindi and Tamil retain their playbook dialogue. The optional cloud rewrite respects Tamil language selection and rejects invented identifiers and unsafe commitments.

The model operations panel reports actual AI reply latency and fallback counts. The backend now bounds request sizes, validates JSON/consent/turns/voiceprints, prevents overlapping call mutations, rejects cross-origin requests, writes the store atomically, and enforces sequential case review. Erasure now also clears caller number, classification and flags. This remains a single-user localhost prototype; real telephony, bank delivery, authentication and production deployment are separate integrations.

New endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | App status and model reply metrics |
| `GET /api/analysis/queue` | Calls ordered by heuristic review priority |
| `GET /api/calls/:id/analysis` | Cited analysis of an existing call |
| `POST /api/analysis` | `{transcript}` or `{callId}`, with optional `useAI: true` |

Run `npm test` for extraction, linking, analysis, model-output validation, case transitions and HTTP lifecycle tests. HTTP tests use an isolated temporary store; your demo data is preserved. Set `CHAKRAVYUH_DATA_FILE` to use a different local data file.

| Page | What it shows |
| --- | --- |
| Command center | Outcome KPIs (scammer minutes absorbed, mule IDs, rings, open cases, golden-hour hit rate, hang-up → dossier time, ₹0 lost), calls per day by scam type, highest-risk rings, live activity, where mule money goes, who scammers impersonate |
| Live decoy | The call: consent gate, persona switch, six-stage playbook, live transcript, identifier chips with IFSC checks, reply latency. Side panel: caller ID check against known rings, **live “known mule” alerts**, red flags, what the caller said, guardrails triggered. Reveal card at hang-up |
| Ring graph | Every call and identifier as a force graph, rings grouped and coloured, click a ring for its evidence, calls, banks, numbers, case and dossier; look up any UPI ID / account / phone / IFSC |
| Cases | Kanban from “Dossier ready” to “Accounts frozen”, golden-hour countdowns, NCRP acknowledgement capture, history |
| Mule feed | Risk-scored UPI IDs and accounts for bank fraud desks, filters, CSV and JSON API |
| Call log | Every call with transcript and the playbook's decision on each turn; “Not a scam” erases content (DPDP) |
| Playbooks | Per scam type: story, red flags, what they ask for, persona tactics, sample lines you can play, classifier cues |
| Telco & API | Architecture (three entry points → decoy → three consumers), **telco diversion simulator**, API reference, business model |
| Privacy & audit | Consent per channel, retention, guardrails, audit log of every dossier view, export and lookup |

## Demo script (about 5 minutes)

1. **Command center (30 s).** Two weeks of synthetic history: 32 calls already linked into rings. Point at scammer minutes absorbed and ₹0 lost.
2. **Call 1 (90 s).** Live decoy → type a caller number → tick consent → *Answer with microphone*. A teammate plays a FedEx parcel / digital-arrest scammer. Show the persona switching to Kamala, the stages advancing, chips appearing with the IFSC check. End the call: “recorded as a new pattern”, dossier ready in milliseconds.
3. **Call 2 (60 s).** Different number, same teammate, now a bank-KYC scammer who gives the same account. The **known mule alert fires during the call**. At hang-up: “joins ring”, with the shared account and voice match.
4. **Golden hour (45 s).** Open the dossier (complaint draft, freeze letters, timestamped transcript, evidence hash). Cases → move the ring to “Reviewed”, record an NCRP acknowledgement, send freeze requests; the countdown stops.
5. **Scale (45 s).** Telco & API → divert 20 flagged calls. Watch the graph, mule feed and cases grow; most join known rings.
6. **Close.** “Telcos divert the calls in, the AI keeps scammers talking, and cyber cells and banks act on what we extract.”

Backup: the *Rehearsal* buttons on Live decoy play calls 1 and 2 without a microphone. *Reset demo data* (sidebar) restores the history before each run.

**Using speakers with the microphone:** recognition pauses during all app speech, including AI fillers and voice previews. It starts a fresh recognition session 650 ms after playback ends to let speaker echoes settle. Wait for **Listening to caller** before speaking. Microphone interruptions during the decoy's spoken turn are disabled in this speaker-safe mode. Delayed results from old recognition sessions are discarded.

## How the proposal maps to this build

| Proposal | In this build | Production path |
| --- | --- | --- |
| Adaptive personas in Tamil, Hindi, English | Classifier labels 7 scam types from cue phrases and relabels as the story escalates; 3 personas; line banks in English, Hindi and Tamil; memory of caller details, reactions, deliberate mishearing, direct answers; alternating microphone and speaker turns | Same playbook; Claude words the lines (wired, off until a key is approved) |
| Telephony (Twilio, merge call) | Browser mic, consent gate, citizen-merge channel; telco diversion simulated through `/api/v1/telco/divert` | Twilio / Exotel number; operator SIP trunk |
| STT / TTS (Sarvam, Deepgram, Bulbul) | Browser speech recognition and neural Edge voices; ~0.3 s reply latency, measured on screen | Sarvam / Deepgram streaming, Bulbul |
| Regex + LLM extraction, IFSC validation | Spoken-form normalisation (“V E R I F Y dot R B I at the rate okaxis”), Hindi and Tamil number words, UPI / account / IFSC / phone / link / amount, offline IFSC bank table, optional live Razorpay lookup | Same + LLM for messy cases, OCR of screenshots |
| ECAPA voiceprints | Lite voiceprint (MFCC statistics + pitch) from the mic; synthetic vectors for rehearsal and history | SpeechBrain ECAPA-TDNN |
| Script clusters (embeddings + HDBSCAN) | Word-trigram overlap marks script campaigns; campaigns never merge rings on their own | Multilingual embeddings + HDBSCAN |
| Honeytokens | Unique decoy name and door number per call; quoting one back links calls | Telco-held decoy numbers |
| Neo4j graph | In-memory graph, stable ring ids, risk scores | Neo4j shared with I4C and banks |
| 1930 dossier (WeasyPrint) | HTML packet → print to PDF; freeze letter per mule account / UPI ID; SHA-256 evidence hash; case workflow and golden-hour clock | Filed by the complainant; feeds to I4C Suspect Registry and bank desks |
| Bank intelligence feed | Risk-scored mule feed, CSV / JSON, lookup API, audit log | Per-bank keys, mutual TLS |
| Ethics, DPDP | Consent gate, “not a scam” erasure with tombstone, guardrails in code, no tracking or hack-back | Retention policy agreed with the pilot cyber cell |

All history, numbers, UPI IDs and accounts are synthetic.

## Options that need a decision

- **Free local dialogue model (installed):** `npm run start:ai` starts a project-local Ollama server (port 11435, models in `E:\hackathon\ollama-models`, your own Ollama app untouched), loads `qwen2.5:1.5b` (986 MB) and starts the console. On this i3 laptop a full rewrite of each line took 6 to 13 s, so the local model only adds a short, unscripted reaction to what the caller said (about 1.2 to 1.7 s, 3 s on the first line after a persona switch); the playbook's move follows word for word. Reactions that break character (refusals, "prank", "assist", numbers) are discarded and the playbook line is used. Switch it on or off live on the Live decoy page (*Dialogue: Playbook only / Playbook + local AI*). First start loads the model in about 40 s.
- **Claude instead:** `CHAKRAVYUH_LLM=claude` with `ANTHROPIC_API_KEY` (paid) rewrites whole lines with the full call history.
- **Voice threshold:** `CHAKRAVYUH_VOICE_T` (default 0.82) tunes the lite voiceprint; calibrate on the venue mic.
- **IFSC live lookup:** `IFSC_LIVE=1` checks branches against Razorpay's free public API.

## Layout

- `server.mjs`: HTTP + server-sent events, all routes.
- `lib/extract.mjs`, `lib/classifier.mjs`: spoken-form extraction, scam labels.
- `lib/persona.mjs`, `lib/dialogue.mjs`: personas, honeytokens, playbook, memory, guardrail.
- `lib/graph.mjs`: voice and script clustering, ring linking, risk.
- `lib/cases.mjs`, `lib/dossier.mjs`, `lib/intel.mjs`: case workflow, audit, 1930 packet, mule feed, lookup, analytics.
- `lib/simulate.mjs`, `lib/seed.mjs`: synthetic rings, history, telco batches, rehearsal scripts.
- `public/js/`: the console (one module per page), speech engine, charts; `public/graph.js` force graph; `public/voiceprint.js` browser voiceprint.
