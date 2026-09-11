// Shared, admin-editable layer stored in Netlify Blobs and merged on top of the
// static panels.json by the app. Everyone can GET it (statuses + edits are
// public); only a valid admin token may POST changes.
//
//   GET  -> { status:{panel:{live,at}}, circuits:{panel:{n:{desc,amps,poles}}}, edited:{panel:"MM/DD/YYYY"} }
//   POST { action:'setStatus',  panel, live }              (admin)
//   POST { action:'editCircuit', panel, n, desc, amps, poles }  (admin)
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const KEY = 'data';
const EMPTY = { status: {}, circuits: {}, edited: {} };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function validToken(token) {
  const ADMIN = process.env.ADMIN_CODE || '';
  if (!ADMIN || !token) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  const good = crypto.createHmac('sha256', ADMIN).update(exp).digest('hex');
  const a = Buffer.from(sig); const b = Buffer.from(good);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// MM/DD/YYYY to match the "DATE TYPED" field on the schedules.
function today() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

export default async (req) => {
  const store = getStore('asbuilt-overrides');

  if (req.method === 'GET') {
    const data = (await store.get(KEY, { type: 'json' })) || EMPTY;
    return json(data);
  }

  if (req.method === 'POST') {
    const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!validToken(auth)) return json({ ok: false, error: 'unauthorized' }, 401);

    let body = {};
    try { body = await req.json(); } catch { return json({ ok: false, error: 'bad body' }, 400); }
    const data = (await store.get(KEY, { type: 'json' })) || structuredClone(EMPTY);
    data.status = data.status || {}; data.circuits = data.circuits || {}; data.edited = data.edited || {};

    const panel = String(body.panel || '');
    if (!panel) return json({ ok: false, error: 'no panel' }, 400);

    if (body.action === 'setStatus') {
      data.status[panel] = { live: !!body.live, at: new Date().toISOString() };
    } else if (body.action === 'editCircuit') {
      const n = String(body.n);
      data.circuits[panel] = data.circuits[panel] || {};
      data.circuits[panel][n] = {
        desc: body.desc != null ? String(body.desc) : '',
        amps: body.amps === '' || body.amps == null ? '' : Number(body.amps),
        poles: body.poles === '' || body.poles == null ? '' : Number(body.poles),
      };
      data.edited[panel] = today(); // updates the panel's "DATE TYPED"
    } else {
      return json({ ok: false, error: 'bad action' }, 400);
    }

    await store.setJSON(KEY, data);
    return json({ ok: true, data });
  }

  return json({ ok: false }, 405);
};
