// One command to run Chakravyuh with the free local dialogue model:
//   npm run start:ai
// Starts a project-local Ollama server (models stored in E:\hackathon\ollama-models, port 11435)
// unless one is already up, loads the model into memory, then starts the console.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const MODEL = process.env.CHAKRAVYUH_OLLAMA_MODEL || 'qwen2.5:1.5b';
const PORT = process.env.CHAKRAVYUH_OLLAMA_PORT || '11435';
const URL = `http://127.0.0.1:${PORT}`;
// Not OLLAMA_MODELS: on this laptop that points at the personal Ollama app's folder.
const MODELS_DIR = process.env.CHAKRAVYUH_MODELS_DIR || resolve(import.meta.dirname, '..', '..', 'ollama-models');
const OLLAMA = process.env.OLLAMA_EXE || ['E:\\Ollama\\ollama.exe', 'C:\\Program Files\\Ollama\\ollama.exe'].find(existsSync) || 'ollama';

const up = async () => {
  try {
    return (await fetch(`${URL}/api/version`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

if (!(await up())) {
  console.log(`Starting Ollama on ${URL} (models in ${MODELS_DIR})`);
  const child = spawn(OLLAMA, ['serve'], { env: { ...process.env, OLLAMA_HOST: `127.0.0.1:${PORT}`, OLLAMA_MODELS: MODELS_DIR }, stdio: 'ignore', detached: true, windowsHide: true });
  child.unref();
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
}

const tags = await fetch(`${URL}/api/tags`).then((r) => r.json()).catch(() => ({ models: [] }));
if (!tags.models?.some((m) => m.name === MODEL || m.name === `${MODEL}:latest`)) {
  console.error(`Model ${MODEL} is not downloaded yet. Run:\n  set OLLAMA_HOST=127.0.0.1:${PORT}& set OLLAMA_MODELS=${MODELS_DIR}& "${OLLAMA}" pull ${MODEL}`);
  process.exit(1);
}

// Load the model now and keep it in memory, so the first caller line is not slow. The context size
// must match the one used for replies, or Ollama reloads the model (30-40 s on this laptop).
process.stdout.write(`Loading ${MODEL}... `);
const t0 = Date.now();
await fetch(`${URL}/api/generate`, { method: 'POST', body: JSON.stringify({ model: MODEL, prompt: 'Hello', keep_alive: '2h', options: { num_predict: 1, num_ctx: 1024 } }) }).catch(() => {});
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

Object.assign(process.env, { CHAKRAVYUH_LLM: 'ollama', CHAKRAVYUH_OLLAMA_MODEL: MODEL, OLLAMA_URL: URL });
await import('../server.mjs');
