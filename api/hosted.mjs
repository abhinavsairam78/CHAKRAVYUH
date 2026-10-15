import { Readable } from 'node:stream';
import { handleRequest, withDemoStore } from '../server.mjs';

// Stateless demo transport. Each browser owns its data; no shared server filesystem.
export default async function hosted(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'Use POST for the browser demo transport.' })); }
  try {
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw Object.assign(new Error('Cross-origin request rejected'), { status: 403 });
    let input;
    if (req.body && typeof req.body === 'object') input = req.body;
    else {
      let raw = '', size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2500000) throw Object.assign(new Error('Demo storage limit reached. Export your evidence and reset the demo.'), { status: 413 }); raw += chunk; }
      input = JSON.parse(raw);
    }
    if (JSON.stringify(input).length > 2500000) throw Object.assign(new Error('Demo storage limit reached.'), { status: 413 });
    const { path, method, body, state } = input;
    if (typeof path !== 'string' || !/^\/(?:api\/|dossier\/)/.test(path) || path.startsWith('/api/events') || path.startsWith('/api/hosted') || !['GET', 'POST'].includes(method)) throw Object.assign(new Error('Unsupported demo route'), { status: 400 });
    const result = await withDemoStore(state, async () => {
      const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
      request.method = method; request.url = path; request.headers = req.headers;
      const headers = {}, chunks = [];
      let status = 200;
      const response = {
        headersSent: false,
        setHeader(name, value) { headers[name.toLowerCase()] = value; },
        writeHead(code, values = {}) { status = code; this.headersSent = true; for (const [k,v] of Object.entries(values)) headers[k.toLowerCase()] = v; },
        write(value) { if (value) chunks.push(Buffer.from(value)); },
        end(value) { if (value) chunks.push(Buffer.from(value)); }
      };
      await handleRequest(request, response);
      const text = Buffer.concat(chunks).toString('utf8');
      return { status, headers, data: headers['content-type']?.includes('application/json') ? JSON.parse(text) : text };
    });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = 200; res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = error.status || (error instanceof SyntaxError ? 400 : 500);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: error.status ? error.message : 'Unable to process demo request.' }));
  }
}
