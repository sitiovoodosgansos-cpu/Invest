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

    // OS TERMOS DO PROPRIO LOTE — percentual e preco de referencia do ovo.
    //
    // Sem estes tres campos, `hasRateOverride(bird)` dava false na tela do
    // investidor e ela mostrava "(padrao geral)": 10% e o preco geral, para
    // TODA ave. Enquanto isso o lucro que ele recebe e calculado com o
    // percentual de verdade do lote.
    //
    // Ou seja, a tela dizia 10% e o pagamento saia por 7,9%. Numero errado na
    // tela e pior que numero nenhum: o investidor confere, a conta nao fecha, e
    // quem parece desonesto e o criatorio.
    //
    // Uma ave sem venda de ovo ficava ainda pior — "Ovo sem preco" —, porque o
    // unico preco que chegava aqui vinha do indice de vendas observadas
    // (precoOvoDoLote, fonte 'venda'), nunca do que foi configurado no card.
    //
    // Nao ha vazamento: sao as condicoes das aves DELE, o combinado dele. Nada
    // nestes campos pertence a outro investidor.
    eggProfitRate: typeof bird.eggProfitRate === 'number' ? bird.eggProfitRate : undefined,
    birdProfitRate: typeof bird.birdProfitRate === 'number' ? bird.birdProfitRate : undefined,
    precoOvoReferencia: typeof bird.precoOvoReferencia === 'number'
      ? bird.precoOvoReferencia
      : undefined,
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

// A fatia de UM investidor no calculo de lucro, ja no formato que sai daqui.
//
// Mora nesta funcao — e nao em duas — porque agora tem dois autores: a rotina
// diaria a GRAVA em portalResumo/{investorId}, e este arquivo a DEVOLVE. Se
// cada lado montasse o proprio objeto, bastaria alguem acrescentar um campo de
// um lado pro portal passar a mostrar um numero e o resumo gravado mostrar
// outro — e a diferenca so apareceria pro investidor.
//
// publicSale e idempotente de proposito: aplicar de novo sobre a propria saida
// devolve o mesmo objeto. E o que permite gravar ja recortado (documento
// pequeno) e AINDA passar pelo recorte na volta, sem duplicar regra nenhuma.
export function resumoDoInvestidor(fatia, investorId) {
  const f = fatia || {};
  return {
    eggProfit: Number(f.eggProfit) || 0,
    birdProfit: Number(f.birdProfit) || 0,
    totalProfit: Number(f.totalProfit) || 0,
    items: (Array.isArray(f.items) ? f.items : []).map(s => publicSale(s, investorId)),
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

// O Firestore aceita no maximo 30 valores num `in` — e o limite e de disjuncoes,
// nao do operador: 30 vale pra `in` e `array-contains-any` juntos na mesma
// consulta. Aqui cada consulta tem um `in` so, entao 30 e o teto exato.
const LIMITE_IN = 30;

function emBlocos(lista, tamanho) {
  const saida = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
}

// Le SO as linhas do espelho que pertencem a estes lotes.
//
// POR QUE ISTO EXISTE
// -------------------
// Antes esta funcao nao existia: o endpoint fazia `.get()` nas cinco colecoes
// do espelho INTEIRAS e so depois filtrava com mirrorBelongsTo, em JavaScript.
// O recorte estava certo — nunca vazou linha de ninguem — mas a conta era paga
// sobre a base toda. Com o espelho de vendas na casa dos milhares de
// documentos, CADA abertura do link de um investidor custava alguns milhares de
// leituras pra devolver algumas dezenas de linhas. A cota diaria gratuita do
// Firestore (50 mil leituras) acabava antes do meio-dia e o portal respondia
// 503 pro resto do dia — foi exatamente o que os registros da Vercel mostraram.
//
// Empurrando o filtro pro servidor do Firestore, a leitura passa a custar so o
// que casa.
//
// DUAS CONSULTAS, NAO UMA
// -----------------------
// mirrorBelongsTo casa por DOIS campos (originGroupId OU ornabirdGroupId). Um
// OU entre campos diferentes existe no Firestore (Filter.or), mas ele conta as
// disjuncoes dos dois lados somadas: `or(in[30], in[30])` = 60, o dobro do
// limite. Duas consultas separadas, unidas por id, dao o MESMO conjunto sem
// esbarrar nisso — e sem indice composto, porque cada uma filtra por um campo
// so e o Firestore ja indexa campo simples sozinho.
async function lerEspelhoDoInvestidor(db, colecao, groupIds) {
  const ids = [...groupIds].filter(Boolean);
  if (ids.length === 0) return [];

  const porId = new Map();
  for (const campo of ['originGroupId', 'ornabirdGroupId']) {
    for (const bloco of emBlocos(ids, LIMITE_IN)) {
      const snap = await db.collection(colecao).where(campo, 'in', bloco).get();
      // A linha que casa pelos dois campos volta duas vezes; o Map desempata
      // pelo id e ela entra uma vez so.
      snap.docs.forEach(d => porId.set(d.id, { id: d.id, ...d.data() }));
    }
  }
  return [...porId.values()];
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

  // O LUCRO: uma leitura quando a rotina ja calculou, a base toda quando nao.
  //
  // A colecao `sales` nao da pra recortar por consulta, e por um motivo que nao
  // e falta de indice: o dono de uma venda sai de tres caminhos no
  // calculateProfitDistribution, e o terceiro e matchSaleToBird(description,
  // birds) — casamento por TEXTO da descricao. Uma venda sem matchedBirdId e
  // sem matchedInvestorId ainda pode ser deste investidor, e so da pra saber
  // lendo a descricao. Filtrar por `where('matchedInvestorId','==',id)` pegaria
  // a maioria e perderia justamente essas: ele veria menos lucro do que tem
  // direito, sem nenhum erro na tela.
  //
  // Entao a leitura nao foi recortada — foi MUDADA DE HORA. A rotina diaria le
  // `sales` uma vez, calcula, e grava a fatia de cada um em portalResumo/{id}.
  // Aqui isso vira uma leitura.
  //
  // O caminho ao vivo continua inteiro embaixo, e nao e sobra: cobre o
  // investidor novo cadastrado depois da ultima rodada, o resumo grande demais
  // pro limite de 1 MB do Firestore, e o dia em que a rotina falhou. Nesses
  // casos o portal fica caro — e certo. Nunca o contrario.
  let mine;
  let resumoCalculadoEm = null;
  const resumoSnap = await db.doc(`portalResumo/${investor.id}`).get();
  if (resumoSnap.exists) {
    const r = resumoSnap.data() || {};
    mine = resumoDoInvestidor(r, investor.id);
    resumoCalculadoEm = r.calculadoEm || null;
  } else {
    // O birdList e o plantel INTEIRO de proposito: com so as aves dele, uma
    // venda que casaria com a ave de outro passaria a casar com a dele.
    // Recortar a entrada do calculo muda quem recebe.
    const salesSnap = await db.collection('sales').get();
    const allSales = salesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const { distribution } = calculateProfitDistribution(allSales, allBirds, rates);
    mine = resumoDoInvestidor(distribution[investor.id], investor.id);
  }

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
    const [trayRows, vitrineRows, eggRows, batchRows, listingRows] = await Promise.all([
      lerEspelhoDoInvestidor(db, 'ornabirdTrays', myGroupIds),
      lerEspelhoDoInvestidor(db, 'ornabirdVitrine', myGroupIds),
      lerEspelhoDoInvestidor(db, 'ornabirdEggCollections', myGroupIds),
      lerEspelhoDoInvestidor(db, 'ornabirdIncubatorBatches', myGroupIds),
      lerEspelhoDoInvestidor(db, 'ornabirdVitrineListings', myGroupIds),
    ]);
    // A consulta ja recortou por lote, entao este filtro nao tira mais nada.
    // Fica de proposito: esta e a funcao que decide o que sai do servidor, e o
    // recorte nao pode depender de UMA consulta estar escrita certa. Custa uma
    // passada numa lista que agora e pequena, e e a ultima linha de defesa se
    // um `where` for editado errado um dia.
    const meu = (rows) => rows.filter(r => mirrorBelongsTo(r, myGroupIds));
    paginas.ornabirdTrays = meu(trayRows);
    paginas.ornabirdEggCollections = meu(eggRows);
    paginas.ornabirdIncubatorBatches = meu(batchRows);
    paginas.ornabirdVitrineListings = meu(listingRows);
    // Nome do cliente sai: e cliente do criatorio, nao do investidor. Mesma
    // decisao ja tomada em publicVitrineSale.
    paginas.ornabirdVitrine = meu(vitrineRows).map(({ customer, ...resto }) => resto);
    myTrays = meu(trayRows).map(publicTray);
    myVitrine = meu(vitrineRows)
      .map(v => publicVitrineSale(v, resolveRateFor(mirrorBird(v, myBirds), !!v.isEgg, rates)));
    // A coleta agora e espelhada do Ornabird, entao ela e filtrada pelo LOTE e
    // nao pelo birdId gravado no documento — que nao existe mais. Mesma regra
    // das bandejas: lote nao vinculado nao pertence a investidor nenhum e nao
    // sai do servidor.
    myEggCollections = meu(eggRows).map(c => publicEggCollection(c, mirrorBird(c, myBirds)));
    // Chocagem segue a mesma regra de posse: lote nao vinculado, ou vinculado
    // a outro investidor, nao sai do servidor.
    myBatches = meu(batchRows).map(b => publicBatch(b, mirrorBird(b, myBirds)));
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
      // O publicSale roda de novo aqui, e o resumoDoInvestidor ja o aplicou.
      // E idempotente, entao nao muda nada — e fica porque a redacao pertence a
      // SAIDA. Se um dia alguem gravar em portalResumo por outro caminho, o que
      // sai daqui continua sendo o que esta funcao deixa sair.
      sales: (mine.items || []).map(sale => publicSale(sale, investor.id)),
      summary: {
        eggProfit: mine.eggProfit || 0,
        birdProfit: mine.birdProfit || 0,
        totalProfit: mine.totalProfit || 0,
      },
      // De quando e o numero acima. Nulo quando foi calculado ao vivo — aí e
      // deste instante. A tela usa pra dizer "atualizado em ..." em vez de
      // deixar o investidor supor que e de agora.
      resumoCalculadoEm,
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
