// A rotina de todo dia: sincroniza com o Ornabird e emite as ordens.
//
// Roda em dois lugares, com o MESMO codigo de proposito:
//   * /api/cron-diario, disparado pela Vercel de madrugada;
//   * /api/ordens com action:"rodar", quando o dono clica "Rodar agora".
// Se fossem dois caminhos diferentes, o botao testaria uma coisa e as 6h
// rodaria outra — e a diferenca so apareceria num dia em que ninguem olha.
//
// A CADEIA PARA NO PRIMEIRO ERRO. Se a sincronizacao falhar, a rotina NAO
// emite ordem nenhuma. Emitir seria pior que falhar: com o espelho velho, um
// investidor que vendeu hoje receberia um "voce nao vendeu nada hoje", e o
// dono nao teria motivo pra desconfiar.

import { getFirebase } from './_firebase.js';
import { syncGroups } from './ornabird.js';
import { construirOrdens, diaBrasilia } from '../src/utils/ordens.js';
import { jsonEstavel } from '../src/utils/helpers.js';
import { enviarEmail, htmlResumoAdmin } from './_email.js';

// Nome do espelho na resposta da sincronizacao -> colecao do Firestore.
const ESPELHOS = {
  trays: 'ornabirdTrays',
  eggCollections: 'ornabirdEggCollections',
  incubatorBatches: 'ornabirdIncubatorBatches',
  vitrineListings: 'ornabirdVitrineListings',
  vitrine: 'ornabirdVitrine',
};

// Limite do Firestore e 500 operacoes por lote; 400 deixa folga.
const LOTE = 400;

async function commitEmLotes(db, operacoes) {
  for (let i = 0; i < operacoes.length; i += LOTE) {
    const batch = db.batch();
    for (const aplicar of operacoes.slice(i, i + LOTE)) aplicar(batch);
    await batch.commit();
  }
}

// Grava um espelho, escrevendo SO as linhas que mudaram.
//
// Mesma logica do navegador (AppContext.replaceOrnabirdMirror) e pela mesma
// razao: regravar as ~1.600 linhas a cada rodada estourou a cota diaria do
// Firestore. Numa rotina automatica isso seria pior — quebraria de madrugada,
// sem ninguem olhando, e derrubaria junto o resto do dia.
async function gravarEspelho(db, colecao, rows) {
  const snap = await db.collection(colecao).get();
  const anteriorPorId = new Map();
  snap.forEach(d => anteriorPorId.set(d.id, d.data()));

  const idsRecebidos = new Set(rows.map(r => r?.id).filter(Boolean));
  const sumiram = [...anteriorPorId.keys()].filter(id => !idsRecebidos.has(id));

  const mudadas = [];
  for (const row of rows) {
    const { id, ...resto } = row || {};
    if (!id) continue;
    // undefined nao existe no Firestore e derruba a gravacao inteira; o
    // round-trip por JSON limpa isso do mesmo jeito que no navegador.
    const payload = JSON.parse(JSON.stringify(resto));
    const anterior = anteriorPorId.get(id);
    if (anterior && jsonEstavel(anterior) === jsonEstavel(payload)) continue;
    mudadas.push({ id, payload });
  }

  await commitEmLotes(db, [
    ...sumiram.map(id => (b) => b.delete(db.collection(colecao).doc(id))),
    ...mudadas.map(({ id, payload }) => (b) => b.set(db.collection(colecao).doc(id), payload)),
  ]);

  return { gravadas: mudadas.length, apagadas: sumiram.length, inalteradas: rows.length - mudadas.length };
}

export async function rodarRotinaDiaria({ agora = new Date() } = {}) {
  const { db } = getFirebase();

  const appSnap = await db.collection('config').doc('appData').get();
  const app = appSnap.exists ? appSnap.data() : {};
  const birds = Array.isArray(app.birds) ? app.birds : [];
  const investors = Array.isArray(app.investors) ? app.investors : [];
  const rates = { eggProfitRate: app.eggProfitRate, birdProfitRate: app.birdProfitRate };

  const groupIds = [...new Set(birds.map(b => b?.ornabirdGroupId).filter(Boolean))];

  // --- 1. Sincronizacao ---
  let payload = {
    trays: [], eggCollections: [], incubatorBatches: [],
    vitrineListings: [], vitrine: [], warnings: [], unknownGroupIds: [],
  };
  if (groupIds.length > 0) {
    payload = await syncGroups({ groupIds, from: null, to: null });
  }

  const espelhos = {};
  for (const [chave, colecao] of Object.entries(ESPELHOS)) {
    // Lote nenhum vinculado significa espelho vazio de verdade. Passar direto
    // pelo gravarEspelho apagaria o espelho inteiro — o que esta certo, mas so
    // se a sincronizacao realmente rodou. Com groupIds vazio ela nem rodou.
    if (groupIds.length === 0) {
      espelhos[chave] = { gravadas: 0, apagadas: 0, inalteradas: 0 };
      continue;
    }
    espelhos[chave] = await gravarEspelho(db, colecao, payload[chave] || []);
  }

  // --- 2. Ordens ---
  //
  // As ordens existentes sao o registro de quais vendas ja foram pagas (ver
  // vendasJaEmOrdem, em src/utils/ordens.js), entao a colecao inteira e lida a
  // cada rodada. Sao poucos documentos por dia; quando isso ficar pesado — na
  // casa dos milhares — vale um indice separado com os ids ja pagos.
  const ordensSnap = await db.collection('paymentOrders').get();
  const ordensExistentes = ordensSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const { ordens, semDono, referenceDate } = construirOrdens({
    vendas: payload.vitrine || [],
    birds,
    investors,
    rates,
    ordensExistentes,
    agora,
  });

  await commitEmLotes(
    db,
    ordens.map(({ id, ...resto }) => (b) =>
      b.set(db.collection('paymentOrders').doc(id), JSON.parse(JSON.stringify(resto)))
    )
  );

  // --- 3. O aviso da madrugada pro dono ---
  //
  // Sai DEPOIS de gravar as ordens, nunca antes: um e-mail dizendo "pague
  // estes cinco" sobre ordens que nao chegaram a existir mandaria o dono pagar
  // com base num documento que a tela nao tem. Gravado primeiro, o e-mail e no
  // maximo redundante.
  //
  // A falha no envio nao derruba a rodada. As ordens ja estao gravadas e
  // aparecem na tela de qualquer jeito; o e-mail e a conveniencia, nao o
  // sistema. O motivo da falha fica no retorno e vai pro registro da rodada.
  let email = { enviado: false, motivo: 'sem_destinatario_admin' };
  const paraOAdmin = (process.env.ORDEM_EMAIL_ADMIN || '').trim();
  if (paraOAdmin && ordens.length > 0) {
    email = await enviarEmail({
      to: paraOAdmin,
      subject: `Ordens de pagamento · ${referenceDate}`,
      html: htmlResumoAdmin({
        referenceDate,
        ordens,
        semDono,
        avisos: payload.warnings || [],
      }),
    });
  }

  return {
    email,
    referenceDate: referenceDate || diaBrasilia(agora),
    groupIds: groupIds.length,
    espelhos,
    ordens: ordens.length,
    aPagar: ordens.reduce((s, o) => s + o.totalProfit, 0),
    avisosZero: ordens.filter(o => o.kind === 'zero').length,
    semDono,
    warnings: payload.warnings || [],
    unknownGroupIds: payload.unknownGroupIds || [],
  };
}

// Roda e deixa registrado como foi, em /config/rotinaDiaria.
//
// Sem este registro, uma rodada que falha as 6h nao deixa rastro nenhum na
// tela: o dono abre o Invest, ve a lista de ontem e nao tem como distinguir
// "hoje ninguem vendeu" de "a rotina nem rodou". As duas coisas parecem iguais
// e significam o oposto. O erro e gravado ANTES de subir, entao mesmo uma
// falha aparece la.
export async function rodarERegistrar({ agora = new Date(), origem = 'cron' } = {}) {
  const { db } = getFirebase();
  const registro = db.collection('config').doc('rotinaDiaria');
  try {
    const resumo = await rodarRotinaDiaria({ agora });
    await registro.set({
      lastRunAt: new Date().toISOString(),
      origem,
      ok: true,
      resumo: JSON.parse(JSON.stringify(resumo)),
      error: null,
    });
    return resumo;
  } catch (err) {
    await registro
      .set({
        lastRunAt: new Date().toISOString(),
        origem,
        ok: false,
        // Codigo e mensagem, nunca o valor de uma credencial: os erros daqui
        // vem de ornabird.js, que ja usa codigos secos ('ornabird_unauthorized'
        // e afins) exatamente para nao carregarem segredo.
        error: String(err?.code || err?.message || 'erro desconhecido'),
      })
      .catch(() => {});
    throw err;
  }
}
