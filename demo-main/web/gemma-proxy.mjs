// Gemma for the care team's AI rehab plan, served by Vite itself (dev server and `vite preview`) at
// POST /api/gemma  {prompt} -> {text, model}. Ported from stuti/server/public/gemma-server.mjs (gemma()).
// The API key stays on the server; the browser only sends the prompt.
//
// Env (web/.env.local, or the host's environment):
//   GEMMA_BACKEND=api (default)  Google AI Studio, needs GOOGLE_API_KEY. GEMMA_MODEL optional.
//   GEMMA_BACKEND=ollama         Gemma on this computer through Ollama (free, no key). OLLAMA_MODEL optional.

const FALLBACKS = ['gemma-4-31b-it'];
const MAX_BODY = 200_000;

async function gemma(env, text) {
  const backend = env.GEMMA_BACKEND || 'api';
  if (backend === 'ollama') {
    const model = env.OLLAMA_MODEL || 'gemma3:4b';
    if (!/^gemma/i.test(model)) throw Object.assign(new Error('OLLAMA_MODEL must be a Gemma model'), { status: 500 });
    const r = await fetch(`${env.OLLAMA_URL || 'http://localhost:11434'}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: text }] }),
    }).catch(() => null);
    if (!r?.ok) throw Object.assign(new Error(`Ollama is not answering: is it running, and did you run "ollama pull ${model}"?`), { status: 503 });
    return { text: (await r.json()).message?.content ?? '', model };
  }

  const key = env.GOOGLE_API_KEY;
  if (!key) {
    throw Object.assign(new Error('Gemma is not set up: add GOOGLE_API_KEY (free from Google AI Studio) to web/.env.local and restart the dev server.'), {
      status: 503,
    });
  }
  const first = env.GEMMA_MODEL || 'gemma-4-26b-a4b-it';
  const models = [first, ...FALLBACKS.filter((m) => m !== first)];
  if (!models.every((m) => /^gemma/i.test(m))) throw Object.assign(new Error('GEMMA_MODEL must be a Gemma model'), { status: 500 });
  let lastErr;
  for (const model of models) {
    // Google sometimes returns a temporary 429/5xx: retry once, then fall back to the next Gemma model.
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }] }),
      });
      if (r.ok) {
        const parts = (await r.json()).candidates?.[0]?.content?.parts ?? [];
        const out = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
        if (out) return { text: out, model };
        lastErr = new Error(`Gemma returned no text on ${model}`);
        break;
      }
      lastErr = new Error(`Gemma API ${r.status} on ${model}: ${(await r.text()).slice(0, 150)}`);
      console.warn(lastErr.message);
      if (![429, 500, 502, 503, 504].includes(r.status)) break; // other errors will not fix themselves
      await new Promise((ok) => setTimeout(ok, 2000));
    }
  }
  throw Object.assign(lastErr ?? new Error('Gemma call failed'), { status: 502 });
}

/** Connect middleware for Vite: handles POST /api/gemma, passes everything else on. */
export function gemmaMiddleware(env) {
  return async (req, res, next) => {
    if (req.url !== '/api/gemma') return next();
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > MAX_BODY) return send(413, { error: 'Prompt too large' });
      }
      const prompt = JSON.parse(body || '{}').prompt;
      if (typeof prompt !== 'string' || !prompt.trim()) return send(400, { error: 'body must be JSON {prompt}' });
      const out = await gemma(env, prompt);
      console.log(`[gemma] answered by ${out.model}`);
      send(200, out);
    } catch (err) {
      console.error('[gemma]', err.message);
      send(err.status || 502, { error: err.message });
    }
  };
}
