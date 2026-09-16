// Shared, admin-editable layer stored in Netlify Blobs and merged on top of the
// static panels.json by the app. Everyone can GET it (statuses + edits are
// public); only a valid admin token may POST changes.
//
//   GET  -> { status:{panel:{n:{live,at}}}, panelStatus:{panel:{live,at}},
//            circuits:{panel:{n:{desc,amps,poles}}}, edited:{panel:{by,at}} }
//   POST { action:'setStatus',   panel, n, live }                 (admin)
//   POST { action:'setPanelStatus', panel, live }                 (admin)
//   POST { action:'setAllStatus', panel, live, ns }               (admin)
//   POST { action:'editCircuit',  panel, n, desc, amps, poles }   (admin) — stamps edited{by,at}
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const KEY = 'data';
const EMPTY = { status: {}, circuits: {}, edited: {}, panelStatus: {} };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Verify the HMAC token and return the admin's initials, or null if invalid.
// Token shape: `${who}.${exp}.${sig}`  (sig = HMAC(secret, `${who}.${exp}`)).
function tokenIdentity(token) {
  const SECRET = process.env.ADMIN_CODES || process.env.ADMIN_CODE || '';
  if (!SECRET || !token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [who, exp, sig] = parts;
  if (!exp || !sig || Date.now() > Number(exp)) return null;
  const good = crypto.createHmac('sha256', SECRET).update(`${who}.${exp}`).digest('hex');
  const a = Buffer.from(sig); const b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return who || 'ADMIN';
}

// MM/DD/YYYY to match the "DATE TYPED" field on the schedules.
function today() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

export default async (req) => {
  const store = getStore({ name: 'asbuilt-overrides', consistency: req.method === 'POST' ? 'strong' : 'eventual' });

  if (req.method === 'GET') {
    const data = (await store.get(KEY, { type: 'json' })) || EMPTY;
    return json(data);
  }

  if (req.method === 'POST') {
    const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const who = tokenIdentity(auth);
    if (who === null) return json({ ok: false, error: 'unauthorized' }, 401);

    let body = {};
    try { body = await req.json(); } catch { return json({ ok: false, error: 'bad body' }, 400); }
    const data = (await store.get(KEY, { type: 'json' })) || structuredClone(EMPTY);
    data.status = data.status || {}; data.circuits = data.circuits || {}; data.edited = data.edited || {}; data.panelStatus = data.panelStatus || {};

    const panel = String(body.panel || '');
    if (!panel) return json({ ok: false, error: 'no panel' }, 400);

    if (data.status[panel] && typeof data.status[panel].live === 'boolean') data.status[panel] = {};

    if (body.action === 'setPanelStatus') {
      data.panelStatus[panel] = { live: !!body.live, at: new Date().toISOString(), by: who };
    } else if (body.action === 'setStatus') {
      data.status[panel] = data.status[panel] || {};
      data.status[panel][String(body.n)] = { live: !!body.live, at: new Date().toISOString(), by: who };
    } else if (body.action === 'setAllStatus') {
      data.status[panel] = data.status[panel] || {};
      const at = new Date().toISOString();
      (Array.isArray(body.ns) ? body.ns : []).forEach((n) => { data.status[panel][String(n)] = { live: !!body.live, at, by: who }; });
    } else if (body.action === 'editCircuit') {
      const n = String(body.n);
      data.circuits[panel] = data.circuits[panel] || {};
      data.circuits[panel][n] = {
        desc: body.desc != null ? String(body.desc) : '',
        amps: body.amps === '' || body.amps == null ? '' : Number(body.amps),
        poles: body.poles === '' || body.poles == null ? '' : Number(body.poles),
      };
      data.edited[panel] = { by: who, at: today() }; // updates the panel's "DATE TYPED" + who
    } else {
      return json({ ok: false, error: 'bad action' }, 400);
    }

    await store.setJSON(KEY, data);
    return json({ ok: true, data });
  }

  return json({ ok: false }, 405);
};
