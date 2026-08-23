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

import { requireAdmin, codigoDoErro } from './_firebase.js';

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
    err.contentType = res.headers.get('content-type');
    throw err;
  }

  // Resposta 2xx que nao e JSON. Acontece quando algo se mete no caminho e
  // devolve HTML — pagina de login da protecao de deploy da Vercel, portal de
  // rede, proxy. Antes isso rebentava dentro de res.json() e virava 500 mudo:
  // o erro parecia bug do Invest, quando a chamada nem chegou ao Ornabird.
  try {
    return await res.json();
  } catch {
    const err = new Error('ornabird respondeu algo que nao e JSON');
    err.code = 'ornabird_not_json';
    err.status = res.status;
    err.contentType = res.headers.get('content-type');
    throw err;
  }
}

// O que da pra registrar do endereco SEM vazar segredo: se a pessoa colou o
// token no lugar da URL, logar o valor inteiro publicaria a credencial no log.
// origin (esquema + host) basta pra identificar o destino errado.
function safeTarget() {
  const raw = process.env.ORNABIRD_API_URL?.trim();
  if (!raw) return '(vazio)';
  try {
    return new URL(raw).origin;
  } catch {
    return `(nao e URL, ${raw.length} caracteres)`;
  }
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
    // O card usa o titulo do lote como cabecalho; so cai pra raca quando a
    // bandeja nao tem lote (bandeja externa).
    flockGroupTitle: t.flockGroupTitle ?? null,
    speciesLabel: t.speciesLabel,
    breedLabel: t.breedLabel,
    varietyLabel: t.varietyLabel ?? null,
    eggCount: t.eggCount ?? 0,
    discardedCount: t.discardedCount ?? 0,
    status: t.status,
    // Validade. expiresAt e DATA ABSOLUTA de proposito: este espelho fica
    // guardado no Firestore e so e reescrito na proxima sincronizacao, entao
    // guardar "faltam 2 dias" azedaria sozinho. A tela calcula na hora.
    expiryDays: t.expiryDays ?? null,
    entries: (t.entries || []).map(e => ({
      id: e.id,
      entryDate: e.entryDate,
      initialCount: e.initialCount ?? 0,
      soldCount: e.soldCount ?? 0,
      discardedCount: e.discardedCount ?? 0,
      transferredCount: e.transferredCount ?? 0,
      available: e.available ?? 0,
      expiresAt: e.expiresAt ?? null,
      // COLLECTION (do próprio criatório) ou EXTERNAL (ovo comprado de fora).
      source: e.source ?? null,
    })),
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
    // Especie, raca e variedade SEPARADAS.
    //
    // `description` vem concatenada ("Galinha Sedosa do Japao") e nao da pra
    // desmontar aqui sem adivinhar qual palavra e a especie — "Gallopavo Peru"
    // desmontaria errado. Separado na origem, cada tela escolhe o que mostrar.
    speciesName: s.speciesName ?? null,
    breedName: s.breedName ?? null,
    varietyName: s.varietyName ?? null,
    // A data de ORIGEM do que foi vendido, com o tipo junto porque o rotulo
    // muda: 'birth' (nasceu aqui), 'purchase' (entrou comprada), 'collected'
    // (ovo coletado). Nulo no lancamento manual, que nao tem lote nem origem.
    originDate: s.originDate ?? null,
    originKind: s.originKind ?? null,
  }));
}

export function normaliseEggCollections(rootId, rows) {
  return (rows || []).map(c => ({
    id: c.id,
    // Só a data, sem hora: a tela agrupa por dia (calendário, somatórios de
    // semana/mês/ano) e comparar string ISO completa com "YYYY-MM-DD" nunca
    // casaria.
    date: (c.date || '').slice(0, 10),
    totalEggs: c.totalEggs ?? c.quantity ?? 0,
    goodEggs: c.goodEggs ?? 0,
    crackedEggs: c.crackedEggs ?? 0,
    notes: c.notes ?? null,
    flockGroupTitle: c.flockGroupTitle ?? null,
    ornabirdGroupId: rootId,
    originGroupId: c.flockGroupId ?? null,
  }));
}

// Pulls every page of `sales` for the requested lots. The other lists are not
// paginated upstream, so the first response already holds them in full.
export function normaliseIncubatorBatches(rootId, rows) {
  return (rows || []).map(b => ({
    id: b.id,
    // Data de entrada so o dia, como nas coletas: a tela agrupa por dia.
    setDate: (b.setDate || '').slice(0, 10),
    eggCount: b.eggCount ?? 0,
    hatchedCount: b.hatchedCount ?? 0,
    infertileCount: b.infertileCount ?? 0,
    embryoLossCount: b.embryoLossCount ?? 0,
    pippedDiedCount: b.pippedDiedCount ?? 0,
    status: b.status ?? null,
    hatchDate: b.hatchDate ?? null,
    lotCode: b.lotCode ?? null,
    notes: b.notes ?? null,
    // Dias de incubacao ja resolvidos LA (Tabela de eclosao ou keyword);
    // a previsao e recalculada na tela como setDate + incubationDays, em vez
    // de viajar como "faltam N dias" — que azedaria parado no espelho.
    incubationDays: b.incubationDays ?? null,
    expectedHatchDate: b.expectedHatchDate ?? null,
    speciesName: b.speciesName ?? null,
    flockGroupTitle: b.flockGroupTitle ?? null,
    incubatorId: b.incubatorId ?? null,
    incubatorName: b.incubatorName ?? null,
    incubatorStatus: b.incubatorStatus ?? null,
    incubatorDescription: b.incubatorDescription ?? null,
    ornabirdGroupId: rootId,
    originGroupId: b.flockGroupId ?? null,
  }));
}

export function normaliseVitrineListings(rootId, rows) {
  return (rows || []).map(l => ({
    id: l.id,
    flockGroupTitle: l.flockGroupTitle ?? null,
    speciesName: l.speciesName ?? null,
    breedName: l.breedName ?? null,
    varietyName: l.varietyName ?? null,
    title: l.title ?? null,
    birthDate: (l.birthDate || '').slice(0, 10),
    // Idade e preco ja vem resolvidos de la, juntos. Recalcular a idade aqui
    // arriscaria mostrar uma idade que nao corresponde ao preco exibido.
    ageInMonths: l.ageInMonths ?? 0,
    currentPrice: l.currentPrice ?? null,
    isOverride: !!l.isOverride,
    missingTier: !!l.missingTier,
    initialQuantity: l.initialQuantity ?? 0,
    availableQuantity: l.availableQuantity ?? 0,
    males: l.males ?? 0,
    females: l.females ?? 0,
    unknownSex: l.unknownSex ?? 0,
    photos: Array.isArray(l.photos) ? l.photos : [],
    status: l.status ?? null,
    isResale: !!l.isResale,
    lastVaccination: l.lastVaccination ?? null,
    purchaseDate: l.purchaseDate ?? null,
    vendorName: l.vendorName ?? null,
    // Discriminadores do agrupamento em card: ave 1:1 nunca mescla, chocada
    // mescla por dia de nascimento, lote avulso por idade+preco.
    sourceBirdId: l.sourceBirdId ?? null,
    sourceIncubatorBatchId: l.sourceIncubatorBatchId ?? null,
    createdAt: l.createdAt ?? null,
    ornabirdGroupId: rootId,
    originGroupId: l.flockGroupId ?? null,
  }));
}

export async function syncGroups({ groupIds, from, to }) {
  const trays = [];
  const eggCollections = [];
  const incubatorBatches = [];
  const vitrineListings = [];
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
      // Só `sales` pagina lá em cima; bandejas e coletas ja vem inteiras na
      // primeira resposta, e repetir nas paginas seguintes duplicaria tudo.
      if (firstPage) {
        trays.push(...normaliseTrays(rootId, group.trays));
        eggCollections.push(...normaliseEggCollections(rootId, group.eggCollections));
        incubatorBatches.push(...normaliseIncubatorBatches(rootId, group.incubatorBatches));
        vitrineListings.push(...normaliseVitrineListings(rootId, group.vitrineListings));
      }
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

  return {
    trays, eggCollections, incubatorBatches, vitrineListings, vitrine,
    warnings, unknownGroupIds,
  };
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
        return res.status(200).json({
          trays: [], eggCollections: [], incubatorBatches: [],
          vitrineListings: [], vitrine: [], warnings: [], unknownGroupIds: [],
        });
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
    // O CLIENTE recebe um codigo grosso (nunca o erro cru, que pode revelar
    // host e estado da credencial). Mas o LOG DO SERVIDOR precisa do detalhe:
    // sem isto, um erro inesperado virava um "500" pelado no painel da Vercel,
    // sem uma linha dizendo o que quebrou — foi assim que a investigacao deste
    // bug ficou girando em suposicoes. Token nunca entra aqui; ver safeTarget.
    console.error(
      '[ornabird]',
      JSON.stringify({
        code: err?.code ?? null,
        name: err?.name ?? null,
        message: err?.message ?? null,
        upstreamStatus: err?.status ?? null,
        upstreamContentType: err?.contentType ?? null,
        target: safeTarget(),
      })
    );

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
    if (err?.code === 'ornabird_not_json') return res.status(502).json({ error: 'ornabird_not_json' });
    if (err?.code === 'ornabird_error') return res.status(502).json({ error: 'ornabird_error' });

    // ERRO DO FIRESTORE, e nao do Ornabird.
    //
    // O firebase-admin devolve `code` NUMERICO, entao nenhuma comparacao com
    // string acima pega — e a cota estourada do Firestore virava
    // "server_error", que a tela traduz como "falha antes de chegar ao
    // Ornabird". Manda o dono procurar defeito no lado errado, num dia em que
    // o problema e so a cota diaria. E o caso 8, que ja aconteceu duas vezes.
    const doFirestore = codigoDoErro(err);
    if (typeof doFirestore === 'string' && doFirestore.startsWith('firestore_')) {
      return res.status(503).json({ error: doFirestore });
    }

    return res.status(500).json({ error: 'server_error' });
  }
}
