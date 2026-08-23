// Server-side portal data endpoint.
//
// WHY THIS EXISTS
// ---------------
// The portals used to read Firestore straight from the browser and filter the
// result in JS. Because /config/appData, /sales and /eggCollections are
// world-readable, that meant every visitor received the ENTIRE database —
// every investor's CPF, password hash, portal token, financials and receipt
// images — and the "privacy" was purely cosmetic.
//
// This function moves the filtering to the server. It runs with the Firebase
// Admin SDK (which bypasses security rules by design), resolves the portal
// token itself, and returns ONLY the slice the caller is entitled to. Once the
// portals consume this endpoint, `allow read` on those collections can be
// locked down to admins and the exposure closes for good.
//
// SECURITY NOTES
// --------------
//   * The token arrives in the POST body, never in the URL, so it does not
//     land in access logs, browser history or Referer headers.
//   * Responses are marked no-store. A CDN caching one investor's payload and
//     serving it to another would be catastrophic, so caching is refused at
//     every layer.
//   * Nothing in the response identifies another investor. Bird ownership
//     history is stripped because its entries carry previous owners' ids.
//   * The service account key lives only in the FIREBASE_SERVICE_ACCOUNT
//     environment variable. It is never bundled into the browser.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { calculateProfitDistribution, resolveRateFor } from '../src/utils/helpers.js';
import { codigoDoErro } from './_firebase.js';

// Os UNICOS codigos de erro que este endpoint devolve alem de `server_error`.
//
// A lista e fechada de proposito. Esta rota e PUBLICA — quem tem o link entra,
// sem login — entao devolver o erro cru abriria caminho de sonda: mensagem de
// Firestore carrega caminho de documento, e caminho de documento e mapa do
// banco. Estes cinco nomes sao categorias, nao conteudo: dizem "o banco
// recusou" sem dizer o que tem dentro dele.
//
// O QUE MOTIVOU: o portal caiu inteiro com "O servidor nao conseguiu montar os
// dados" quando a cota diaria do Firebase estourou. A causa (code 8) estava
// dentro do erro, mas o catch engolia tudo em `server_error` — a mesma cegueira
// que fazia a tela de ordens mostrar "falhou: 8". Um link revogado ja tinha
// mensagem propria (token_not_found), entao quem via este texto estava sempre
// diante de uma falha de infraestrutura, sem nenhuma forma de saber disso.
const CODIGOS_SEGUROS = new Set([
  'firestore_quota',
  'firestore_permission',
  'firestore_indisponivel',
  'firestore_timeout',
  'firestore_unauthenticated',
]);

// Traduz o erro num par (status, codigo) seguro de expor.
function respostaDeErro(err) {
  const codigo = codigoDoErro(err);
  // No log fica so o codigo, nunca a mensagem: da pra diagnosticar sem
  // carregar caminho de documento nenhum pro registro da Vercel.
  console.error('[portal]', JSON.stringify({ code: codigo, raw: err?.code ?? null }));
  if (CODIGOS_SEGUROS.has(codigo)) return { status: 503, error: codigo };
  return { status: 500, error: 'server_error' };
}

// Reuse the Admin app across warm invocations; initializing twice throws.
let cachedDb = null;
function getDb() {
  if (cachedDb) return cachedDb;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    const err = new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
    err.code = 'not_configured';
    throw err;
  }
  const creds = JSON.parse(raw);
  if (!getApps().length) {
    initializeApp({ credential: cert(creds), projectId: creds.project_id });
  }
  cachedDb = getFirestore();
  return cachedDb;
}

// Only the fields the investor portal actually renders. Everything else —
// document (CPF), loginUsername, loginPassword hash, portalTokenId — is
// deliberately dropped even for the investor's own record.
function publicInvestor(investor) {
  return {
    id: investor.id,
    name: investor.name || '',
    email: investor.email || '',
    phone: investor.phone || '',
  };
}

// Ownership history is removed: its entries carry the ids of previous owners,
// which would disclose that another investor exists and which animals moved.
// The server already resolved attribution, so the client never needs it.
function publicBird(bird, investorId) {
  return {
    id: bird.id,
    // Always the caller's own id (we only return birds they currently own),
    // so this discloses nothing while keeping the portal's filters working.
    investorId,
    species: bird.species || '',
    breed: bird.breed || '',
    matrixCount: bird.matrixCount ?? '',
    breederCount: bird.breederCount ?? '',
    investmentValue: bird.investmentValue ?? '',
    createdAt: bird.createdAt || '',
    // O ID DO LOTE NO ORNABIRD. Sem ele, as telas do portal nao conseguem
    // ligar nenhuma linha do espelho a nenhuma ave: toda coleta, bandeja,
    // chocagem e venda aparecia como "sem vinculo", o lucro dava R$ 0,00 e a
    // tela ainda mandava o investidor "abrir o Plantel e editar o animal".
    //
    // Nao revela nada: e o id de um lote que ELE possui, e o recorte que este
    // mesmo servidor faz ja e por este id. Ele so recebe as proprias aves.
    ornabirdGroupId: bird.ornabirdGroupId || null,
  };
}

// A sale as the portal shows it, with the profit already computed server-side.
// matchedBirdId is dropped (internal identifier); matchedInvestorId is kept
// but always equals the caller's OWN id, which they already know — it lets the
// portal keep using calculateProfitDistribution unchanged on the scoped list.
function publicSale(item, investorId) {
  return {
    id: item.id || '',
    date: item.date || '',
    orderNumber: item.orderNumber || '',
    itemDescription: item.itemDescription || item.item || '',
    quantity: item.quantity ?? 1,
    totalValue: Number(item.totalValue) || 0,
    isEgg: !!item.isEgg,
    rate: Number(item.rate) || 0,
    profitRate: Number(item.rate) || 0,
    profit: Number(item.profit) || 0,
    matchedBreed: item.matchedBird || item.matchedBreed || '',
    matchedInvestorId: investorId,
  };
}

// Operational records the employee portal needs. Deliberately excludes every
// financial and personal field: no investors, no sales, no payments, no
// aportes, no expenses (whose rows also carry base64 receipt images).
function employeeBird(bird) {
  return {
    id: bird.id,
    species: bird.species || '',
    breed: bird.breed || '',
    matrixCount: bird.matrixCount ?? '',
    annualEggPotential: bird.annualEggPotential ?? '',
    birdNotes: bird.birdNotes || '',
    individuals: Array.isArray(bird.individuals) ? bird.individuals : [],
  };
}


// Coleta de ovos espelhada do Ornabird, na forma que o portal ja servia do
// cadastro manual antigo. O `birdId` nao vem mais do documento: a coleta
// pertence a um LOTE, e a linha do Plantel e resolvida pelo vinculo — a mesma
// regra de posse das bandejas e da vitrine.
function publicEggCollection(c, bird) {
  return {
    id: c.id,
    date: c.date || '',
    birdId: bird ? bird.id : '',
    quantity: Number(c.totalEggs) || 0,
    cracked: Number(c.crackedEggs) || 0,
    notes: c.notes || '',
  };
}

// A linha do Plantel dona de uma linha espelhada, ou null quando o lote nunca
// foi vinculado. Mesma precedencia do resto: originGroupId primeiro.
function mirrorBird(row, birds) {
  return birds.find(b =>
    b.ornabirdGroupId === row.originGroupId || b.ornabirdGroupId === row.ornabirdGroupId) || null;
}

// Lote de chocagem espelhado do Ornabird, na forma que o portal ja servia do
// cadastro manual. A posse vem do VINCULO do lote com o Plantel, como no resto
// do espelho; o mapa `eggs` (que era por ave) vira uma entrada unica da ave
// vinculada, para o portal continuar somando do mesmo jeito.
function publicBatch(batch, bird) {
  const eggCount = Number(batch.eggCount) || 0;
  const hatched = Number(batch.hatchedCount) || 0;
  const infertil = Number(batch.infertileCount) || 0;
  const naoDesenvolveu = Number(batch.embryoLossCount) || 0;
  const morreuNoOvo = Number(batch.pippedDiedCount) || 0;
  const birdId = bird ? bird.id : '';
  return {
    id: batch.id,
    incubatorId: batch.incubatorId || '',
    incubatorName: batch.incubatorName || '',
    dateIn: (batch.setDate || '').slice(0, 10),
    dateHatch: (batch.hatchDate || '').slice(0, 10),
    status: batch.status || '',
    eggs: birdId ? { [birdId]: eggCount } : {},
    hatchResults: birdId
      ? { [birdId]: { hatched, infertil, naoDesenvolveu, morreuNoOvo } }
      : {},
    totalEggs: eggCount,
    totalHatched: hatched,
    totalInfertil: infertil,
    totalNaoDesenvolveu: naoDesenvolveu,
    totalMorreuNoOvo: morreuNoOvo,
  };
}

// Ornabird mirror rows for this investor. Both collections carry the flock
// group they came from; a row only belongs to somebody once that group is
// linked to a Plantel row (bird.ornabirdGroupId). Rows whose group is not
// linked to THIS investor never leave the server.
function mirrorBelongsTo(row, myGroupIds) {
  if (!row) return false;
  return myGroupIds.has(row.originGroupId) || myGroupIds.has(row.ornabirdGroupId);
}

function publicTray(t) {
  return {
    id: t.id,
    label: t.label || '',
    speciesLabel: t.speciesLabel || '',
    breedLabel: t.breedLabel || '',
    varietyLabel: t.varietyLabel || '',
    eggCount: Number(t.eggCount) || 0,
    discardedCount: Number(t.discardedCount) || 0,
    status: t.status || '',
    createdAt: t.createdAt || '',
  };
}

// Customer names are dropped: they are the farm's clients, not the investor's,
// and the portal has no reason to expose the buyer list.
function publicVitrineSale(v, rate) {
  const amount = Number(v.amount) || 0;
  return {
    id: v.id,
    date: v.date || '',
    description: v.description || '',
    quantity: Number(v.quantity) || 1,
    amount,
    isEgg: !!v.isEgg,
    rate,
    profit: amount * rate,
  };
}

// Resolve a portal token to { type, investorId } without trusting the client.
// Order matters: the /shareTokens collection is authoritative, and the legacy
// forms are only accepted when no token document exists.
async function resolveToken(db, token, app) {
  const snap = await db.doc(`shareTokens/${token}`).get();
  if (snap.exists) {
    const data = snap.data() || {};
    // 'investor' = link antigo do relatorio. 'investor_pages' = link novo das
    // telas operacionais. Os dois resolvem para a MESMA fatia de dados; o que
    // muda e a tela que o portal renderiza. Sao tipos separados para revogar
    // um sem derrubar o outro.
    if ((data.type === 'investor' || data.type === 'investor_pages') && data.investorId) {
      return { type: 'investor', investorId: data.investorId };
    }
    if (data.type === 'employee') {
      return { type: 'employee', investorId: null };
    }
    return null;
  }

  // Legacy employee link: the token was mirrored onto appData.employeeToken
  // before /shareTokens existed.
  if (app.employeeToken && app.employeeToken === token) {
    return { type: 'employee', investorId: null };
  }

  // Legacy investor link: the raw investor id worked as a token, but only for
  // investors never migrated to a portalTokenId. Once migrated, the old URL
  // must stop working.
  const investors = Array.isArray(app.investors) ? app.investors : [];
  const legacy = investors.find(i => i && i.id === token && !i.portalTokenId);
  if (legacy) return { type: 'investor', investorId: legacy.id };

  return null;
}

// Pure payload builder: given a Firestore handle and a token, decide what the
// caller is entitled to. Split out from the HTTP handler so the scoping rules
// can be tested against a fake database — this is the part that must never
// leak, so it is the part that gets tested.
export async function buildPortalPayload(db, token) {
  const t = String(token || '').trim();
  // Real tokens are UUIDs. Reject junk before it ever reaches Firestore.
  if (!t || t.length < 16 || t.length > 200) {
    return { status: 400, body: { error: 'invalid_token' } };
  }

  const appSnap = await db.doc('config/appData').get();
  const app = appSnap.exists ? (appSnap.data() || {}) : {};

  const resolved = await resolveToken(db, t, app);
  if (!resolved) return { status: 404, body: { error: 'token_not_found' } };

  const rates = {
    eggProfitRate: typeof app.eggProfitRate === 'number' ? app.eggProfitRate : undefined,
    birdProfitRate: typeof app.birdProfitRate === 'number' ? app.birdProfitRate : undefined,
  };

  if (resolved.type === 'employee') {
    const [eggSnap, batchSnap] = await Promise.all([
      db.collection('ornabirdEggCollections').get(),
      db.collection('ornabirdIncubatorBatches').get(),
    ]);
    const employeeBirds = Array.isArray(app.birds) ? app.birds : [];
    const employeeBatches = batchSnap.docs.map(d => {
      const row = { id: d.id, ...d.data() };
      return publicBatch(row, mirrorBird(row, employeeBirds));
    });
    return {
      status: 200,
      body: {
        type: 'employee',
        birds: employeeBirds.map(employeeBird),
        eggCollections: eggSnap.docs.map(d => {
          const row = { id: d.id, ...d.data() };
          return publicEggCollection(row, mirrorBird(row, employeeBirds));
        }),
        // As maquinas nao tem cadastro proprio: sao deduzidas dos lotes
        // espelhados, que ja trazem id e nome.
        incubators: Array.from(
          new Map(
            employeeBatches
              .filter(b => b.incubatorId)
              .map(b => [b.incubatorId, { id: b.incubatorId, name: b.incubatorName || 'Chocadeira' }])
          ).values()
        ),
        incubatorBatches: employeeBatches,
        nurseryRooms: app.nurseryRooms || [],
        nurseryBatches: app.nurseryBatches || [],
        nurseryEvents: app.nurseryEvents || [],
        infirmaryBays: app.infirmaryBays || [],
        infirmaryAdmissions: app.infirmaryAdmissions || [],
        treatments: app.treatments || [],
        customTreatmentTypes: app.customTreatmentTypes || [],
      },
    };
  }

  // ---- investor ----
  const investors = Array.isArray(app.investors) ? app.investors : [];
  const investor = investors.find(i => i && i.id === resolved.investorId);
  if (!investor) return { status: 404, body: { error: 'token_not_found' } };

  const allBirds = Array.isArray(app.birds) ? app.birds : [];
  const salesSnap = await db.collection('sales').get();
  const allSales = salesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Attribution runs on the server over the full dataset; only this investor's
  // slice leaves the building.
  const { distribution } = calculateProfitDistribution(allSales, allBirds, rates);
  const mine = distribution[investor.id] || { eggProfit: 0, birdProfit: 0, totalProfit: 0, items: [] };

  // Only animals the investor currently owns — the same set the portal showed
  // before. Including previously-owned animals would mean shipping a bird
  // whose current owner is somebody else.
  const myBirds = allBirds.filter(b => b && b.investorId === investor.id);

  const myBirdIds = new Set(myBirds.map(b => b.id));
  const myGroupIds = new Set(myBirds.map(b => b.ornabirdGroupId).filter(Boolean));

  // Ornabird mirror, scoped by the linked flock groups.
  let myTrays = [];
  let myVitrine = [];
  let myEggCollections = [];
  let myBatches = [];
  // Linhas do espelho como estao guardadas, ja filtradas pelos lotes deste
  // investidor. Alimentam as telas operacionais do portal, que esperam esta
  // forma; os campos "public*" acima continuam servindo o portal de relatorio
  // antigo, que nao muda.
  const paginas = {
    ornabirdTrays: [],
    ornabirdEggCollections: [],
    ornabirdIncubatorBatches: [],
    ornabirdVitrineListings: [],
    ornabirdVitrine: [],
  };
  if (myGroupIds.size > 0) {
    const [traySnap, vitrineSnap, eggSnap, batchSnap, listingSnap] = await Promise.all([
      db.collection('ornabirdTrays').get(),
      db.collection('ornabirdVitrine').get(),
      db.collection('ornabirdEggCollections').get(),
      db.collection('ornabirdIncubatorBatches').get(),
      db.collection('ornabirdVitrineListings').get(),
    ]);
    const meu = (snap) => snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => mirrorBelongsTo(r, myGroupIds));
    paginas.ornabirdTrays = meu(traySnap);
    paginas.ornabirdEggCollections = meu(eggSnap);
    paginas.ornabirdIncubatorBatches = meu(batchSnap);
    paginas.ornabirdVitrineListings = meu(listingSnap);
    // Nome do cliente sai: e cliente do criatorio, nao do investidor. Mesma
    // decisao ja tomada em publicVitrineSale.
    paginas.ornabirdVitrine = meu(vitrineSnap).map(({ customer, ...resto }) => resto);
    myTrays = traySnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => mirrorBelongsTo(t, myGroupIds))
      .map(publicTray);
    myVitrine = vitrineSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(v => mirrorBelongsTo(v, myGroupIds))
      .map(v => publicVitrineSale(v, resolveRateFor(mirrorBird(v, myBirds), !!v.isEgg, rates)));
    // A coleta agora e espelhada do Ornabird, entao ela e filtrada pelo LOTE e
    // nao pelo birdId gravado no documento — que nao existe mais. Mesma regra
    // das bandejas: lote nao vinculado nao pertence a investidor nenhum e nao
    // sai do servidor.
    myEggCollections = eggSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => mirrorBelongsTo(c, myGroupIds))
      .map(c => publicEggCollection(c, mirrorBird(c, myBirds)));
    // Chocagem segue a mesma regra de posse: lote nao vinculado, ou vinculado
    // a outro investidor, nao sai do servidor.
    myBatches = batchSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(b => mirrorBelongsTo(b, myGroupIds))
      .map(b => publicBatch(b, mirrorBird(b, myBirds)));
  }

  // Só as chocadeiras referenciadas por esses lotes, nome apenas — a maquina
  // nao e dado do investidor, mas nao ha razao pra esconder o nome tampouco.
  const myIncubators = Array.from(
    new Map(
      myBatches
        .filter(b => b.incubatorId)
        .map(b => [b.incubatorId, { id: b.incubatorId, name: b.incubatorName || 'Chocadeira' }])
    ).values()
  );

  return {
    status: 200,
    body: {
      type: 'investor',
      investor: publicInvestor(investor),
      birds: myBirds.map(b => publicBird(b, investor.id)),
      eggCollections: myEggCollections,
      trays: myTrays,
      vitrineSales: myVitrine,
      incubatorBatches: myBatches,
      incubators: myIncubators,
      // Fatia crua para as telas operacionais do portal do investidor.
      paginas,
      sales: (mine.items || []).map(sale => publicSale(sale, investor.id)),
      summary: {
        eggProfit: mine.eggProfit || 0,
        birdProfit: mine.birdProfit || 0,
        totalProfit: mine.totalProfit || 0,
      },
      financialInvestments: (app.financialInvestments || [])
        .filter(f => f && f.investorId === investor.id)
        .map(f => ({ id: f.id, investorId: investor.id, amount: f.amount, date: f.date })),
      payments: (app.payments || [])
        .filter(p => p && p.investorId === investor.id)
        .map(p => ({ id: p.id, investorId: investor.id, amount: p.amount, date: p.date, description: p.description || '' })),
      rates,
    },
  };
}

export default async function handler(req, res) {
  // Refuse caching everywhere: this payload is per-investor by definition. A
  // CDN serving one investor's response to another would be catastrophic.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});

  let db;
  try {
    db = getDb();
  } catch (err) {
    if (err.code === 'not_configured') {
      // Lets the client fall back to its previous behaviour during rollout.
      return res.status(503).json({ error: 'not_configured' });
    }
    const r = respostaDeErro(err);
    return res.status(r.status).json({ error: r.error });
  }

  try {
    const { status, body: payload } = await buildPortalPayload(db, body.token);
    return res.status(status).json(payload);
  } catch (err) {
    // Never echo the internal error: it can disclose document paths. O que sai
    // daqui e so a CATEGORIA da falha (ver CODIGOS_SEGUROS), que e o suficiente
    // pra tela dizer se vale tentar de novo ou se e problema do administrador.
    const r = respostaDeErro(err);
    return res.status(r.status).json({ error: r.error });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
