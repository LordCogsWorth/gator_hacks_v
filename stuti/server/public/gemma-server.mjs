// Gemma proxy. Run: node gemma-server.mjs   (Node 18+, no dependencies)
// GEMMA_BACKEND=api    -> Google AI Studio (Gemini API endpoint, Gemma model). Needs GOOGLE_API_KEY.
// GEMMA_BACKEND=ollama -> Gemma running on your own laptop through Ollama (free, no key).
import http from 'node:http';

const BACKEND = process.env.GEMMA_BACKEND || 'api';
const API_KEY = process.env.GOOGLE_API_KEY;
const API_MODEL = process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it';
const FALLBACKS = ['gemma-4-31b-it'];
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';         // or gemma4:e4b
if (!/^gemma/i.test(BACKEND === 'ollama' ? OLLAMA_MODEL : API_MODEL)) throw new Error('Model name must be a Gemma model');
const PORT = process.env.PORT || 8081;
let usedModel = '';

// Instructions go in the user message because Gemma models do not reliably accept a system role.
const prompt = (r) => `You are helping a physiotherapist review a stroke-rehabilitation exercise session.
All numbers below were measured by software. Do not recalculate or invent numbers, and do not diagnose.
Units: for arm_raise and forward_reach "best" is degrees; for hand_open it is % of palm size. reachCm is centimetres.
Write plain text, under 150 words:
1. Two sentences comparing the weak arm with the healthy arm (use symmetryPct, weak.best, healthy.best).
2. Up to 3 specific exercise suggestions tied to the weakest metrics (best value, reps, smoothness, fatigue, compensation).
3. One caution if weak.compPct is above 30 or weak.fatiguePct is below -20.
Session data (JSON):
${JSON.stringify(r)}`;

async function gemma(text) {
  if (BACKEND === 'ollama') {
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST', body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, messages: [{ role: 'user', content: text }] })
    });
    if (!r.ok) throw new Error(`Ollama ${r.status}: is it running, and did you run "ollama pull ${OLLAMA_MODEL}"?`);
    return (await r.json()).message.content;
  }
  if (!API_KEY) throw new Error('Set GOOGLE_API_KEY (free key from Google AI Studio)');
  // Google sometimes returns a temporary 500/503 or 429. Retry once, then fall back to the next Gemma model.
  const models = [API_MODEL, ...FALLBACKS.filter((m) => m !== API_MODEL)];
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }] })
      });
      if (r.ok) {
        const parts = (await r.json()).candidates?.[0]?.content?.parts ?? [];
        usedModel = model;
        return parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      }
      lastErr = new Error(`Gemma API ${r.status} on ${model}: ${(await r.text()).slice(0, 150)}`);
      console.warn(lastErr.message);
      if (![429, 500, 503].includes(r.status)) break;           // other errors will not fix themselves
      await new Promise((ok) => setTimeout(ok, 4000));
    }
  }
  throw lastErr;
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method !== 'POST' || req.url !== '/summary') return res.writeHead(404).end();
  try {
    let body = '';
    for await (const c of req) { body += c; if (body.length > 100000) throw new Error('Payload too large'); }
    const text = await gemma(prompt(JSON.parse(body)));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const model = BACKEND === 'ollama' ? OLLAMA_MODEL : usedModel;
    console.log(`Answered by ${model} via ${BACKEND}`);
    res.end(JSON.stringify({ model, text: `${text.trim()}\n\nWritten by ${model}. Decision support only. A clinician must review this.` }));
  } catch (err) {
    console.error('Request failed:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Gemma proxy on http://localhost:${PORT} (backend: ${BACKEND})`));
