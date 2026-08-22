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

import { getFirebase, codigoDoErro } from './_firebase.js';
import { syncGroups } from './ornabird.js';
import {
  construirOrdens, construirAcerto, listarPendentes, diaBrasilia, ORDEM_STATUS,
} from '../src/utils/ordens.js';
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

  // A TRAVA DO PRIMEIRO USO.
  //
  // "Tudo que ainda nao foi pago" e a regra certa a partir do momento em que o
  // sistema assume os pagamentos. Antes disso, ela significa o historico
  // INTEIRO do criatorio — centenas de vendas que o dono ja pagou a mao ao
  // longo dos meses. A rotina rodando sozinha nesse estado emitiria uma ordem
  // gigante de dinheiro que ja saiu, e nao ha botao de desfazer.
  //
  // Entao a emissao automatica fica parada ate o dono revisar a fila na tela e
  // liberar. Ate la a rodada ainda sincroniza e ainda conta os pendentes — o
  // que ele precisa pra revisar —, so nao emite nada.
  const configSnap = await db.collection('config').doc('ordensConfig').get();
  const liberado = configSnap.exists && configSnap.data()?.automaticoLiberado === true;

  if (!liberado) {
    const { pendentes, semDono: orfas } = listarPendentes({
      vendas: payload.vitrine || [], birds, investors, rates, ordensExistentes,
    });
    return {
      referenceDate: diaBrasilia(agora),
      groupIds: groupIds.length,
      espelhos,
      ordens: 0,
      aPagar: 0,
      avisosZero: 0,
      semDono: orfas,
      // O que a tela precisa pra explicar por que nada foi emitido.
      aguardandoLiberacao: true,
      pendentes: pendentes.length,
      pendentesValor: pendentes.reduce((s, p) => s + p.profit, 0),
      email: { enviado: false, motivo: 'aguardando_liberacao' },
      warnings: payload.warnings || [],
      unknownGroupIds: payload.unknownGroupIds || [],
    };
  }

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
        // Codigo em TEXTO, nunca o valor de uma credencial. Antes isto gravava
        // `err.code` cru, e o erro de cota do Firestore chegava na tela como
        // "falhou: 8" — um numero que nao diz nada a quem le.
        error: codigoDoErro(err) || String(err?.message || 'erro desconhecido'),
      })
      .catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Acoes manuais sobre a fila de pendentes
//
// Existem por causa do primeiro uso: "tudo que ainda nao foi pago" e, na
// estreia, o historico inteiro do criatorio. O dono precisa poder olhar a fila
// e decidir linha a linha o que vira pagamento e o que ja estava quitado.
// ---------------------------------------------------------------------------

// O que as tres acoes precisam ler. Sempre do ESPELHO ja gravado, nunca
// sincronizando de novo: a tela mostrou uma fila, e a acao tem que agir sobre
// exatamente aquela fila. Sincronizar no meio faria o dono selecionar dez
// vendas e o servidor trabalhar sobre onze.
async function carregarFila(db) {
  const [appSnap, vitrineSnap, ordensSnap] = await Promise.all([
    db.collection('config').doc('appData').get(),
    db.collection('ornabirdVitrine').get(),
    db.collection('paymentOrders').get(),
  ]);
  const app = appSnap.exists ? appSnap.data() : {};
  return {
    birds: Array.isArray(app.birds) ? app.birds : [],
    investors: Array.isArray(app.investors) ? app.investors : [],
    rates: { eggProfitRate: app.eggProfitRate, birdProfitRate: app.birdProfitRate },
    vendas: vitrineSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    ordensExistentes: ordensSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

// Emite ordens SO das vendas escolhidas.
//
// `referenceDate` deixa o dono carimbar a ordem com outro dia. O caso real e
// simples: ele pagou no sabado e so foi lancar na segunda — a ordem tem que
// dizer sabado, senao o comprovante do investidor briga com o extrato do banco.
export async function emitirEscolhidas({ saleIds, uid, referenceDate = null, agora = new Date() }) {
  const { db } = getFirebase();
  const fila = await carregarFila(db);

  const { ordens, semDono, referenceDate: dia } = construirOrdens({
    ...fila,
    saleIds,
    referenceDate,
    agora,
    // Sem avisos de "nao vendeu nada": quem ficou de fora ficou porque o dono
    // nao escolheu as vendas dele, e nao porque nao vendeu.
    comAvisoZero: false,
  });

  await commitEmLotes(
    db,
    ordens.map(({ id, ...resto }) => (b) =>
      b.set(db.collection('paymentOrders').doc(id), {
        ...JSON.parse(JSON.stringify(resto)),
        emitidaPor: uid || null,
        origem: 'manual',
      })
    )
  );

  return {
    referenceDate: dia,
    ordens: ordens.length,
    aPagar: ordens.reduce((s, o) => s + o.totalProfit, 0),
    vendas: ordens.reduce((s, o) => s + o.items.length, 0),
    semDono,
  };
}

// Declara as vendas escolhidas como ja acertadas fora do sistema.
export async function acertarEscolhidas({ saleIds, uid, motivo, agora = new Date() }) {
  const { db } = getFirebase();
  const fila = await carregarFila(db);

  const { documentos, total } = construirAcerto({
    ...fila,
    saleIds,
    agora,
    motivo: (motivo || '').trim() || 'Acertado fora do sistema',
  });

  await commitEmLotes(
    db,
    documentos.map(({ id, ...resto }) => (b) =>
      b.set(db.collection('paymentOrders').doc(id), {
        ...JSON.parse(JSON.stringify(resto)),
        emitidaPor: uid || null,
      })
    )
  );

  return { acertadas: total, documentos: documentos.length };
}

// Desfaz uma ordem emitida por engano.
//
// CANCELA, NAO APAGA — e a diferenca importa em tres pontos:
//
//   * Se o comprovante ja saiu (PDF, WhatsApp, e-mail), o investidor tem em
//     maos um documento com um numero de ordem. Apagar o registro faria esse
//     numero nao existir em lugar nenhum, e a conversa seguinte seria sobre um
//     documento que o sistema jura nunca ter emitido.
//   * O documento cancelado guarda QUEM cancelou e QUANDO. Um sumico nao
//     guarda nada, e a pergunta "por que essa venda voltou pra fila?" ficaria
//     sem resposta.
//   * O id continua ocupado. Como o id e derivado de dia + investidor, apagar
//     liberaria o id pra ser reusado por uma ordem nova — dois documentos
//     diferentes com o mesmo numero impresso, em dias diferentes.
//
// O efeito pratico e o que o dono espera de "deletar": a ordem sai das listas
// (`vendasJaEmOrdem` e `saldoOrnabird` pulam canceladas) e as vendas dela
// voltam pra fila de pendentes.
export async function cancelarOrdens({ ids, uid, motivo, agora = new Date() }) {
  const { db } = getFirebase();
  const quando = (agora instanceof Date ? agora : new Date(agora)).toISOString();
  const resultados = [];

  for (const id of ids) {
    const ref = db.collection('paymentOrders').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      resultados.push({ id, ok: false, motivo: 'ordem_nao_encontrada' });
      continue;
    }
    const ordem = snap.data() || {};
    if (ordem.status === ORDEM_STATUS.CANCELADA) {
      // Ja cancelada: nao e erro, so nao ha o que fazer. Repetir a gravacao
      // sobrescreveria quem cancelou primeiro.
      resultados.push({ id, ok: true, jaEstava: true, investorName: ordem.investorName });
      continue;
    }

    await ref.update({
      status: ORDEM_STATUS.CANCELADA,
      canceladaEm: quando,
      canceladaPor: uid || null,
      canceladaMotivo: (motivo || '').trim() || null,
      // O estado anterior fica registrado: cancelar uma ordem que ja estava
      // PAGA e uma coisa bem diferente de cancelar uma que nunca saiu, e quem
      // for conferir isto depois precisa saber qual dos dois aconteceu.
      statusAntesDoCancelamento: ordem.status || null,
    });

    resultados.push({
      id,
      ok: true,
      investorName: ordem.investorName,
      estavaPaga: ordem.status === ORDEM_STATUS.PAGA,
      vendas: (ordem.items || []).length,
    });
  }

  return {
    canceladas: resultados.filter(r => r.ok && !r.jaEstava).length,
    vendasDevolvidas: resultados.reduce((s, r) => s + (r.vendas || 0), 0),
    resultados,
  };
}

// Libera a emissao automatica das 6h. Ate isto acontecer, a rotina sincroniza
// mas nao emite ordem nenhuma (ver a trava em rodarRotinaDiaria).
export async function liberarAutomatico({ uid, agora = new Date() }) {
  const { db } = getFirebase();
  await db.collection('config').doc('ordensConfig').set({
    automaticoLiberado: true,
    liberadoEm: (agora instanceof Date ? agora : new Date(agora)).toISOString(),
    liberadoPor: uid || null,
  });
}
