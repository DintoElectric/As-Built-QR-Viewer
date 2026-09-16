// POST { code } -> { ok, token, who }.  Admin codes live ONLY in the Netlify
// environment variable ADMIN_CODES (never in the shipped app), as a comma list
// of `code:initials` pairs, e.g.  9743:MM,3479:KC,4739:MC .  Each admin logs in
// with their own code; the returned token carries their initials and is HMAC-
// signed, so it can't be forged and edits can be attributed to a person.
// (Legacy single ADMIN_CODE still works, attributed as "ADMIN".)
import crypto from 'node:crypto';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// "9743:MM,3479:KC,4739:MC" -> { '9743':'MM', '3479':'KC', '4739':'MC' }
function codeMap() {
  const raw = process.env.ADMIN_CODES || '';
  const map = {};
  raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((pair) => {
    const i = pair.indexOf(':');
    const code = (i >= 0 ? pair.slice(0, i) : pair).trim();
    const who = (i >= 0 ? pair.slice(i + 1) : '').trim();
    if (code) map[code] = who || 'ADMIN';
  });
  if (!Object.keys(map).length && process.env.ADMIN_CODE) map[process.env.ADMIN_CODE] = 'ADMIN';
  return map;
}
// signing secret — the whole ADMIN_CODES string (or legacy ADMIN_CODE); shared
// with overrides.mjs so tokens verify there. Never leaves the server.
const secret = () => process.env.ADMIN_CODES || process.env.ADMIN_CODE || '';

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  let code = '';
  try { ({ code } = await req.json()); } catch { /* ignore */ }

  const map = codeMap();
  if (!Object.keys(map).length) return json({ ok: false, error: 'ADMIN_CODES not set on the server' }, 500);

  // constant-time compare against each configured code
  let who = null;
  for (const [c, w] of Object.entries(map)) {
    const a = Buffer.from(String(code)); const b = Buffer.from(c);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) { who = w; break; }
  }
  if (who === null) return json({ ok: false, error: 'Wrong code' }, 401);

  const exp = Date.now() + 1000 * 60 * 60 * 12; // token valid 12 hours
  const payload = `${who}.${exp}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return json({ ok: true, token: `${payload}.${sig}`, who });
};
