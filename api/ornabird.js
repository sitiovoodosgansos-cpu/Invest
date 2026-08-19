// Server-side proxy for the Ornabird integration.
//
// WHY THIS EXISTS
// ---------------
// Invest mirrors Ornabird read-only so it can tell each investor what they are
// owed. The browser cannot do that call itself, for two independent reasons:
//
//   1. The Ornabird credential is a secret. Anything the browser holds is
//      readable by whoever opens devtools, and that token reads the whole
//      criatório — every lot, sale and customer name.
//   2. The site's CSP pins connect-src to 'self' plus Google. A fetch straight
//      to ornabird.app would be blocked before it left the page.
//
// So the token lives here, in ORNABIRD_API_TOKEN, and the browser only ever
// talks to /api/ornabird.
//
// SECURITY NOTES
// --------------
//   * Admin only. The caller proves it with a Firebase ID token, which is
//     verified server-side and checked against /users/{uid}.role === 'admin'.
//     An investor portal token is NOT accepted here — portals read their own
//     slice through /api/portal.
//   * Read only. Nothing in this file writes to Ornabird, and the credential
//     it uses only carries read scopes.
//   * Responses are no-store: they carry other people's data (customer names)
//     and must never sit in a CDN.
//   * Upstream errors are not forwarded verbatim — they could leak the
//     Ornabird host or token state. The client gets a coarse code.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

let cachedDb = null;
function getFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    // Um codigo por variavel, em vez de um 'not_configured' generico. As tres
    // variaveis moram em lugares diferentes, e um erro que nao diz QUAL falta
    // custa um redeploy inteiro por palpite — foi o que aconteceu aqui.
    // Nome de variavel nao e segredo; o VALOR nunca sai daqui.
    const err = new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
    err.code = 'missing_firebase';
    throw err;
  }
  if (!getApps().length) {
    const creds = JSON.parse(raw);
    initializeApp({ credential: cert(creds), projectId: creds.project_id });
  }
  if (!cachedDb) cachedDb = getFirestore();
  return { db: cachedDb, auth: getAuth() };
}

// Throws unless the caller is a signed-in admin.
async function requireAdmin(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    const err = new Error('missing id token');
    err.code = 'unauthorized';
    throw err;
  }
  const { db, auth } = getFirebase();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(header.slice(7).trim());
  } catch {
    const err = new Error('invalid id token');
    err.code = 'unauthorized';
    throw err;
  }
  const snap = await db.collection('users').doc(decoded.uid).get();
  if (!snap.exists || snap.data()?.role !== 'admin') {
    const err = new Error('not an admin');
    err.code = 'forbidden';
    throw err;
  }
  return decoded.uid;
}

function ornabirdConfig() {
  // trim(): valor colado com espaco/quebra de linha sobrando e comum e daria
  // um erro muito pior la na frente (401 do Ornabird) do que aqui.
  const baseUrl = process.env.ORNABIRD_API_URL?.trim();
  const token = process.env.ORNABIRD_API_TOKEN?.trim();
  if (!baseUrl) {
    const err = new Error('ORNABIRD_API_URL is not configured');
    err.code = 'missing_ornabird_url';
    throw err;
  }
  if (!token) {
    const err = new Error('ORNABIRD_API_TOKEN is not configured');
    err.code = 'missing_ornabird_token';
    throw err;
  }
  // URL invalida fazia o fetch estourar um TypeError, que caia no catch-all
  // como 500 "server_error" — um erro mudo, que nao diz nem qual variavel nem
  // o que ha de errado com ela. Vale conferir aqui: o modo mais comum de
  // errar essa configuracao e trocar os valores de URL e TOKEN entre si, e
  // nesse caso a "URL" nem parece um endereco.
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    const err = new Error('ORNABIRD_API_URL is not a valid URL');
    err.code = 'bad_ornabird_url';
    throw err;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error('ORNABIRD_API_URL must be http(s)');
    err.code = 'bad_ornabird_url';
    throw err;
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

async function callOrnabird(path, { method = 'GET', body } = {}) {
  const { baseUrl, token } = ornabirdConfig();

  // Falha de rede (DNS, conexao, TLS) faz o fetch REJEITAR em vez de devolver
  // resposta. Sem este catch a excecao virava 500 generico e parecia bug do
  // Invest, quando na verdade e endereco errado ou Ornabird fora do ar.
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    const err = new Error('could not reach ornabird');
    err.code = 'ornabird_unreachable';
    throw err;
  }

  if (!res.ok) {
    // 401/403 mean the credential is wrong or lacks a scope; 402 means the
    // Ornabird subscription lapsed. Each needs a different fix by the owner,
    // so keep them distinguishable without echoing the upstream body.
    const err = new Error(`ornabird ${res.status}`);
    err.code =
      res.status === 401 || res.status === 403
        ? 'ornabird_unauthorized'
        : res.status === 402
          ? 'ornabird_subscription'
          : 'ornabird_error';
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Normalisation
//
// Mirror rows carry TWO group ids and the difference matters for money:
//
//   ornabirdGroupId — the lot the investor actually linked in Plantel (the
//                     root asked for in the sync).
//   originGroupId   — the lot the record really came from, which for chicks is
//                     a hatch group nobody linked.
//
// resolveMirrorBird() prefers originGroupId and falls back to ornabirdGroupId,
// so a chick sale still lands on the investor who owns the parent lot.
// ---------------------------------------------------------------------------

// Exportadas para teste: são a parte com risco real (o mapeamento que decide
// de quem é cada registro no rateio).
export function normaliseTrays(rootId, trays) {
  return (trays || []).map(t => ({
    id: t.id,
    label: t.label,
    speciesLabel: t.speciesLabel,
    breedLabel: t.breedLabel,
    varietyLabel: t.varietyLabel ?? null,
    eggCount: t.eggCount ?? 0,
    discardedCount: t.discardedCount ?? 0,
    status: t.status,
    createdAt: t.createdAt ?? null,
    ornabirdGroupId: rootId,
    originGroupId: t.flockGroupId ?? null,
  }));
}

export function normaliseSales(rootId, sales) {
  return (sales || []).map(s => ({
    id: s.id,
    date: s.date,
    description: s.description,
    quantity: s.quantity ?? null,
    unitPrice: s.unitPrice ?? null,
    // Gross value of the item. Invest applies its own percentage on top.
    amount: s.amount ?? 0,
    customer: s.customer ?? null,
    isEgg: Boolean(s.isEgg),
    source: s.source,
    // "title" marks a manual entry matched by the lot's title, which breaks
    // silently if the card is renamed upstream. Surfaced so the UI can flag it.
    matchedBy: s.matchedBy ?? null,
    ornabirdGroupId: rootId,
    originGroupId: s.originGroupId ?? null,
  }));
}

// Pulls every page of `sales` for the requested lots. The other lists are not
// paginated upstream, so the first response already holds them in full.
export async function syncGroups({ groupIds, from, to }) {
  const trays = [];
  const vitrine = [];
  const warnings = [];
  let unknownGroupIds = [];
  let cursor = null;
  let firstPage = true;
  // Bounded so a bad cursor can never spin forever on a serverless invocation.
  for (let page = 0; page < 50; page += 1) {
    const payload = await callOrnabird('/api/integrations/invest/sync', {
      method: 'POST',
      body: { groupIds, from, to, includeDescendants: true, cursor },
    });

    for (const [rootId, group] of Object.entries(payload.groups || {})) {
      if (firstPage) trays.push(...normaliseTrays(rootId, group.trays));
      vitrine.push(...normaliseSales(rootId, group.sales));
    }
    if (firstPage) {
      unknownGroupIds = payload.unknownGroupIds || [];
      warnings.push(...(payload.warnings || []));
      firstPage = false;
    }

    if (!payload.hasMoreSales || !payload.nextSalesCursor) break;
    cursor = payload.nextSalesCursor;
  }

  return { trays, vitrine, warnings, unknownGroupIds };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    await requireAdmin(req);

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const action = body.action;

    if (action === 'groups') {
      const payload = await callOrnabird('/api/integrations/invest/groups');
      return res.status(200).json({ groups: payload.groups || [] });
    }

    if (action === 'sync') {
      const groupIds = Array.isArray(body.groupIds) ? body.groupIds.filter(Boolean) : [];
      if (groupIds.length === 0) {
        // Nothing linked yet — an empty mirror is the correct answer, and
        // calling upstream with an empty list would just 400.
        return res.status(200).json({ trays: [], vitrine: [], warnings: [], unknownGroupIds: [] });
      }
      const result = await syncGroups({
        groupIds,
        from: body.from || null,
        to: body.to || null,
      });
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (err) {
    if (err?.code === 'unauthorized') return res.status(401).json({ error: 'unauthorized' });
    if (err?.code === 'forbidden') return res.status(403).json({ error: 'forbidden' });
    // 503 = falta configuracao aqui no Invest. O codigo diz qual variavel,
    // pra nao ter que adivinhar uma por vez a cada redeploy.
    if (err?.code === 'missing_firebase') return res.status(503).json({ error: 'missing_firebase' });
    if (err?.code === 'missing_ornabird_url') {
      return res.status(503).json({ error: 'missing_ornabird_url' });
    }
    if (err?.code === 'missing_ornabird_token') {
      return res.status(503).json({ error: 'missing_ornabird_token' });
    }
    if (err?.code === 'bad_ornabird_url') return res.status(503).json({ error: 'bad_ornabird_url' });
    if (err?.code === 'ornabird_unreachable') {
      return res.status(502).json({ error: 'ornabird_unreachable' });
    }
    if (err?.code === 'not_configured') return res.status(503).json({ error: 'not_configured' });
    if (err?.code === 'ornabird_unauthorized') {
      return res.status(502).json({ error: 'ornabird_unauthorized' });
    }
    if (err?.code === 'ornabird_subscription') {
      return res.status(502).json({ error: 'ornabird_subscription' });
    }
    if (err?.code === 'ornabird_error') return res.status(502).json({ error: 'ornabird_error' });
    return res.status(500).json({ error: 'server_error' });
  }
}
