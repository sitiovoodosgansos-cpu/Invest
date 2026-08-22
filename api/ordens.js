// Acoes do administrador sobre as ordens de pagamento.
//
//   rodar   — roda a rotina do dia agora, sem esperar as 6h. Mesmo codigo do
//             cron, de proposito (ver api/_rotina-diaria.js).
//   enviar  — marca as ordens escolhidas como PAGAS e manda o comprovante pro
//             investidor.
//
// POR QUE PAGAR E ENVIAR SAO A MESMA ACAO
// ---------------------------------------
// A regra de negocio e "primeiro sai o dinheiro, depois sai o documento".
// Se marcar-como-paga e enviar fossem dois botoes, existiria o estado
// intermediario "paga mas nao avisada", e alguem so descobriria que o
// investidor nunca foi avisado quando ele perguntasse. Sendo uma acao so, ou
// as duas coisas acontecem ou o erro aparece na hora.
//
// O que NAO e atomico, e nao da pra ser: o e-mail sai de um servidor de
// terceiros. Entao a ordem e gravada como paga PRIMEIRO e o envio vem depois,
// com o resultado registrado em sentAt/sentError. Perder o e-mail de uma ordem
// paga e um reenvio; perder o registro do pagamento e um pagamento duplicado.

import { requireAdmin, getFirebase, codigoDoErro } from './_firebase.js';
import {
  rodarERegistrar, emitirEscolhidas, acertarEscolhidas, liberarAutomatico, cancelarOrdens,
} from './_rotina-diaria.js';
import { enviarEmail, htmlOrdemInvestidor, emailConfigurado } from './_email.js';

async function marcarEEnviar(db, ids, uid) {
  const resultados = [];

  for (const id of ids) {
    const ref = db.collection('paymentOrders').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      resultados.push({ id, ok: false, motivo: 'ordem_nao_encontrada' });
      continue;
    }
    const ordem = { id, ...snap.data() };

    if (ordem.status === 'canceled') {
      resultados.push({ id, ok: false, motivo: 'ordem_cancelada' });
      continue;
    }

    // Aviso de zero vendas nao tem pagamento: e so um aviso. Marca-lo como
    // "pago" registraria um pagamento de R$ 0,00 que nunca aconteceu, e a
    // primeira conferencia de caixa tropecaria nele.
    const ehAviso = ordem.kind === 'zero';
    const jaPaga = ordem.status === 'paid';

    if (!ehAviso && !jaPaga) {
      await ref.update({
        status: 'paid',
        paidAt: new Date().toISOString(),
        paidBy: uid,
      });
      ordem.status = 'paid';
    }

    if (!ordem.investorEmail) {
      await ref.update({ sentError: 'investidor sem e-mail no cadastro' });
      resultados.push({
        id,
        ok: false,
        pago: !ehAviso,
        motivo: 'sem_email',
        investorName: ordem.investorName,
      });
      continue;
    }

    const envio = await enviarEmail({
      to: ordem.investorEmail,
      subject: ehAviso
        ? `Nenhuma venda em ${ordem.referenceDate}`
        : `Pagamento enviado · ordem ${ordem.numero}`,
      html: htmlOrdemInvestidor(ordem),
      replyTo: (process.env.ORDEM_EMAIL_ADMIN || '').trim() || undefined,
    });

    await ref.update(
      envio.enviado
        ? { sentAt: new Date().toISOString(), sentTo: ordem.investorEmail, sentError: null }
        : { sentError: [envio.motivo, envio.detalhe].filter(Boolean).join(': ') }
    );

    resultados.push({
      id,
      ok: envio.enviado,
      pago: !ehAviso,
      motivo: envio.enviado ? null : envio.motivo,
      investorName: ordem.investorName,
    });
  }

  return resultados;
}

// A data escolhida pro carimbo da ordem, ou null pra usar o dia de hoje.
//
// Valida de verdade, e nao so o formato: o dia vira parte do ID do documento no
// Firestore (`20260822-<investidor>-1`). Um "2026-13-45" vindo de um cliente
// adulterado geraria um id que nunca colide com nada — e a protecao contra
// emitir a mesma ordem duas vezes, que depende justamente do id repetir, sairia
// de cena em silencio.
function dataDaOrdem(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const err = new Error('data invalida');
    err.code = 'data_invalida';
    throw err;
  }
  // Round-trip pelo Date: pega 2026-02-31, que passa no formato mas nao existe.
  const d = new Date(`${valor}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== valor) {
    const err = new Error('data invalida');
    err.code = 'data_invalida';
    throw err;
  }
  return valor;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const uid = await requireAdmin(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    if (body.action === 'rodar') {
      const resumo = await rodarERegistrar({ origem: 'manual' });
      return res.status(200).json({ ok: true, ...resumo });
    }

    // Emite ordens SO das vendas escolhidas na tela. E o caminho do primeiro
    // uso: "tudo que ainda nao foi pago" e o historico inteiro do criatorio, e
    // emitir aquilo de uma vez seria pagar de novo o que ja foi pago a mao.
    if (body.action === 'gerar') {
      const saleIds = Array.isArray(body.saleIds) ? body.saleIds.filter(Boolean) : [];
      if (saleIds.length === 0) return res.status(400).json({ error: 'sem_vendas' });
      const referenceDate = dataDaOrdem(body.referenceDate);
      return res.status(200).json({ ok: true, ...(await emitirEscolhidas({ saleIds, uid, referenceDate })) });
    }

    // Declara as vendas escolhidas como ja acertadas fora do sistema. Elas
    // saem da fila sem virar pagamento.
    if (body.action === 'acertar') {
      const saleIds = Array.isArray(body.saleIds) ? body.saleIds.filter(Boolean) : [];
      if (saleIds.length === 0) return res.status(400).json({ error: 'sem_vendas' });
      return res.status(200).json({
        ok: true,
        ...(await acertarEscolhidas({ saleIds, uid, motivo: body.motivo })),
      });
    }

    // Desfaz ordens emitidas por engano. As vendas delas voltam pra fila.
    if (body.action === 'cancelar') {
      const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean).slice(0, 100) : [];
      if (ids.length === 0) return res.status(400).json({ error: 'sem_ordens' });
      return res.status(200).json({
        ok: true,
        ...(await cancelarOrdens({ ids, uid, motivo: body.motivo })),
      });
    }

    if (body.action === 'liberar') {
      await liberarAutomatico({ uid });
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'enviar') {
      const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean).slice(0, 100) : [];
      if (ids.length === 0) return res.status(400).json({ error: 'sem_ordens' });
      const { db } = getFirebase();
      const resultados = await marcarEEnviar(db, ids, uid);
      return res.status(200).json({
        ok: true,
        emailConfigurado: emailConfigurado(),
        resultados,
      });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (err) {
    // codigoDoErro traduz o code NUMERICO do gRPC pra texto. Sem isso, um erro
    // do Firestore (o 8 da cota, por exemplo) atravessava todos os testes
    // abaixo — que comparam com string — e virava "server_error", fazendo a
    // tela culpar o Ornabird por um problema que era do Firebase.
    const codigo = codigoDoErro(err);
    console.error('[ordens]', JSON.stringify({
      code: codigo,
      raw: err?.code ?? null,
      name: err?.name ?? null,
      message: err?.message ?? null,
    }));
    if (codigo === 'data_invalida') return res.status(400).json({ error: 'data_invalida' });
    if (codigo === 'unauthorized') return res.status(401).json({ error: 'unauthorized' });
    if (codigo === 'forbidden') return res.status(403).json({ error: 'forbidden' });
    if (codigo === 'missing_firebase') return res.status(503).json({ error: 'missing_firebase' });
    if (typeof codigo === 'string' && codigo.startsWith('firestore_')) {
      return res.status(503).json({ error: codigo });
    }
    if (typeof codigo === 'string' && codigo.startsWith('ornabird')) {
      return res.status(502).json({ error: codigo });
    }
    if (typeof codigo === 'string' && codigo.startsWith('missing_')) {
      return res.status(503).json({ error: codigo });
    }
    return res.status(500).json({ error: 'server_error' });
  }
}
