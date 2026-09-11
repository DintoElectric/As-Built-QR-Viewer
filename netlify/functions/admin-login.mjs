// POST { code } -> { ok, token }.  The admin code lives ONLY in the Netlify
// environment variable ADMIN_CODE (never in the shipped app), and is checked
// here on the server. On success we return a short-lived HMAC token the app
// sends back on edits; it can't be forged without ADMIN_CODE.
import crypto from 'node:crypto';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  const ADMIN = process.env.ADMIN_CODE || '';
  let code = '';
  try { ({ code } = await req.json()); } catch { /* ignore */ }

  if (!ADMIN) return json({ ok: false, error: 'ADMIN_CODE not set on the server' }, 500);
  // constant-time compare to avoid leaking the code via timing
  const a = Buffer.from(String(code)); const b = Buffer.from(ADMIN);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return json({ ok: false, error: 'Wrong code' }, 401);

  const exp = Date.now() + 1000 * 60 * 60 * 12; // token valid 12 hours
  const sig = crypto.createHmac('sha256', ADMIN).update(String(exp)).digest('hex');
  return json({ ok: true, token: `${exp}.${sig}` });
};
