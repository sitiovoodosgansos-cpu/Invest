// Ordens de pagamento diarias.
//
// Toda manha o sistema junta o que cada investidor tem a receber e emite uma
// ordem por investidor. Este arquivo e so a CONTA — nao fala com o Firestore
// nem com o Ornabird — pra poder ser testado com dados de mentira e pra rodar
// igual no servidor (rotina das 6h) e no navegador (previsao na tela).
//
// -------------------------------------------------------------------------
// A DECISAO QUE DEFINE O RESTO: "ainda nao pago", nao "vendido ontem"
// -------------------------------------------------------------------------
// O caminho obvio seria "as vendas de ontem". Ele perde dinheiro em silencio.
//
// No Ornabird, `soldAt` e DATA DE NEGOCIO e pode ser retroativa — a propria
// documentacao da integracao (docs/INTEGRACAO-ORNABIRD.md) registra isso, e e
// por isso que o cursor de sincronizacao usa createdAt e nao soldAt. Uma venda
// lancada hoje com data de anteontem nunca cairia na varredura de "ontem": nao
// entraria na ordem de anteontem (ja emitida) nem na de hoje (data errada).
// Ninguem receberia erro; o investidor simplesmente nao seria pago.
//
// Entao a varredura e por ESTADO, nao por data: entra na ordem tudo que ainda
// nao foi para nenhuma ordem. Uma venda atrasada aparece na primeira rodada
// depois de ser lancada, com a data de negocio dela preservada na linha.
//
// O efeito colateral bom: a rotina pode rodar duas vezes no mesmo dia sem
// duplicar nada, porque o que ja saiu numa ordem nunca mais e varrido.

import {
  buildOrnabirdGroupIndex,
  resolveMirrorBird,
  resolveBirdInvestorForDate,
  resolveRateFor,
  normalizeDay,
// Com a extensao .js de proposito: este arquivo tambem e carregado pelo Node
// nas funcoes da /api, e o Node ESM nao adivinha extensao como o Vite faz.
} from './helpers.js';

export const ORDEM_STATUS = {
  PENDENTE: 'pending',
  PAGA: 'paid',
  CANCELADA: 'canceled',
};

export const ORDEM_TIPO = {
  PAGAMENTO: 'payment',
  // Investidor que nao vendeu nada. Nao ha dinheiro, entao nao ha o que pagar:
  // vira so um aviso, que pode ser enviado sem passar pelo pagamento.
  ZERO: 'zero',
};

// Centavos. Cada linha e arredondada ANTES de somar, e o total e a soma das
// linhas arredondadas — assim o que esta impresso na ordem fecha com o total.
// Arredondar so no fim daria um total que nao bate com a conta de somar as
// linhas a mao, e essa e a primeira coisa que um investidor confere.
export function arredondar(valor) {
  return Math.round((Number(valor) || 0) * 100) / 100;
}

// O dia (YYYY-MM-DD) no fuso de Brasilia, a partir de um instante qualquer.
//
// A rotina roda num servidor em UTC. Sem esta conversao, uma rodada as 06:00
// de Brasilia (09:00 UTC) ainda estaria certa, mas uma rodada manual as 22h de
// Brasilia (01:00 UTC do dia seguinte) carimbaria a ordem com a data de amanha
// — e o dono veria "ordem de 22/08" numa noite de 21/08.
export function diaBrasilia(instante = new Date()) {
  const d = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(d.getTime())) return '';
  // -03:00 o ano inteiro: o Brasil nao tem horario de verao desde 2019.
  const deslocado = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return deslocado.toISOString().slice(0, 10);
}

// Ids das vendas que ja sairam em alguma ordem.
//
// As proprias ordens sao o registro — nao existe uma colecao separada de
// "vendas pagas". Isso e de proposito: a linha da venda vive DENTRO da ordem
// que a pagou, entao a ordem e ao mesmo tempo o documento que o investidor
// recebe e a prova de que aquela venda ja foi paga. Um segundo lugar guardando
// a mesma verdade seria mais uma coisa pra sair de sincronia.
//
// Ordem cancelada nao conta: as vendas dela voltam pra fila e entram na
// proxima rodada. E o unico jeito de desfazer uma ordem emitida por engano.
export function vendasJaEmOrdem(ordens) {
  const ids = new Set();
  for (const ordem of Array.isArray(ordens) ? ordens : []) {
    if (ordem?.status === ORDEM_STATUS.CANCELADA) continue;
    for (const item of ordem?.items || []) {
      if (item?.saleId) ids.add(item.saleId);
    }
  }
  return ids;
}

// Uma linha da ordem, a partir de uma venda espelhada do Ornabird.
function montarItem(venda, bird, rate) {
  const amount = Number(venda.amount) || 0;
  return {
    saleId: venda.id,
    // Data de NEGOCIO da venda, nao a data da rodada. Uma venda retroativa sai
    // numa ordem de hoje mostrando o dia em que de fato aconteceu.
    date: normalizeDay(venda.date) || null,
    description: venda.description || '(sem descricao)',
    quantity: Number(venda.quantity) || null,
    unitPrice: venda.unitPrice ?? null,
    customer: venda.customer ?? null,
    isEgg: Boolean(venda.isEgg),
    source: venda.source || null,
    // Vinculo por titulo do lote — quebra em silencio se o card for renomeado
    // no Ornabird. Segue na linha pra tela poder marcar como incerto.
    matchedBy: venda.matchedBy ?? null,
    birdId: bird?.id ?? null,
    birdName: bird?.breed || bird?.name || null,
    amount: arredondar(amount),
    // A taxa fica CONGELADA na linha. Se o dono mudar o percentual global
    // depois, uma ordem ja emitida nao pode mudar de valor sozinha — e a mesma
    // regra que as vendas importadas ja seguem com o profitRate delas.
    rate,
    profit: arredondar(amount * rate),
  };
}

// Monta as ordens de uma rodada.
//
// Entra: as vendas espelhadas do Ornabird, o Plantel, os investidores, as
// taxas globais e as ordens que ja existem. Sai: uma ordem por investidor com
// venda nova, um aviso por investidor sem venda, e a lista das vendas que nao
// caem em investidor nenhum.
//
// `semDono` NAO e descartado: venda sem lote vinculado e dinheiro que alguem
// pode estar esperando, e sumir com ela em silencio e exatamente o modo de
// falha que este sistema nao pode ter. Volta pro chamador mostrar na tela.
export function construirOrdens({
  vendas,
  birds,
  investors,
  rates,
  ordensExistentes = [],
  referenceDate = null,
  agora = new Date(),
}) {
  const dia = referenceDate || diaBrasilia(agora);
  const criadoEm = (agora instanceof Date ? agora : new Date(agora)).toISOString();
  const jaPagas = vendasJaEmOrdem(ordensExistentes);
  const groupIndex = buildOrnabirdGroupIndex(birds);
  const investidores = Array.isArray(investors) ? investors : [];

  const porInvestidor = new Map();
  const semDono = [];

  for (const venda of Array.isArray(vendas) ? vendas : []) {
    if (!venda?.id || jaPagas.has(venda.id)) continue;
    const amount = Number(venda.amount) || 0;
    // Venda de valor zero (ou negativa, num estorno) nao gera pagamento. Nao e
    // erro — so nao ha o que ratear.
    if (amount <= 0) continue;

    const bird = resolveMirrorBird(venda, groupIndex);
    const diaVenda = normalizeDay(venda.date);
    // Dono NA DATA DA VENDA, nao o dono de hoje. E o que faz uma transferencia
    // de titularidade creditar corretamente as vendas antigas, sem reescrever
    // nenhuma linha guardada — mesma regra do rateio do relatorio.
    const investorId = bird ? resolveBirdInvestorForDate(bird, diaVenda) : null;
    const investor = investorId ? investidores.find(i => i.id === investorId) : null;

    if (!investor) {
      semDono.push({
        saleId: venda.id,
        date: diaVenda || null,
        description: venda.description || '(sem descricao)',
        amount: arredondar(amount),
        motivo: bird ? 'lote sem investidor' : 'lote nao vinculado no Plantel',
      });
      continue;
    }

    const rate = resolveRateFor(bird, Boolean(venda.isEgg), rates);
    if (!porInvestidor.has(investor.id)) porInvestidor.set(investor.id, []);
    porInvestidor.get(investor.id).push(montarItem(venda, bird, rate));
  }

  // Quantas ordens JA existem hoje — no total e por investidor.
  //
  // Isto e o que torna a rotina segura pra rodar mais de uma vez no mesmo dia,
  // e as duas contagens existem por motivos diferentes:
  //
  //   * por investidor, pro id da ordem nova nao repetir o de uma ordem de
  //     hoje que ja existe. Um id repetido nao daria erro: o Firestore
  //     SOBRESCREVERIA a ordem antiga. Se ela ja estivesse paga, o registro do
  //     pagamento sumiria, as vendas dela voltariam pra fila e seriam pagas
  //     uma segunda vez — sem nada na tela indicando o que aconteceu.
  //   * no dia, pro numero visivel da ordem seguir contando de onde parou.
  //
  // Ordem cancelada tambem conta: o id dela continua ocupado no banco.
  const doDia = (Array.isArray(ordensExistentes) ? ordensExistentes : [])
    .filter(o => o?.referenceDate === dia);
  const jaTemHoje = new Map();
  for (const o of doDia) {
    jaTemHoje.set(o.investorId, (jaTemHoje.get(o.investorId) || 0) + 1);
  }

  const ordens = [];
  let sequencia = doDia.length;

  for (const investor of investidores) {
    const itens = porInvestidor.get(investor.id) || [];
    // Da venda mais antiga pra mais nova: a ordem se le como um extrato.
    itens.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const temVenda = itens.length > 0;

    // Aviso de zero vendas so pra quem quer receber. O padrao e receber — foi
    // o pedido —, mas um investidor que so vende de vez em quando levaria um
    // e-mail identico todo dia, e o caminho natural dali e ele marcar o
    // remetente como spam. Ai a ordem de pagamento de verdade tambem some.
    if (!temVenda && investor.avisoZeroVendas === false) continue;

    // E aviso nenhum se ja existe uma ordem dele hoje. Numa segunda rodada do
    // mesmo dia, quem foi pago de manha receberia um "voce nao vendeu nada
    // hoje" a tarde — uma mensagem falsa, contradizendo o comprovante que ele
    // acabou de receber.
    if (!temVenda && jaTemHoje.has(investor.id)) continue;

    sequencia += 1;
    const nDoInvestidor = (jaTemHoje.get(investor.id) || 0) + 1;
    const totalAmount = arredondar(itens.reduce((s, i) => s + i.amount, 0));
    const totalProfit = arredondar(itens.reduce((s, i) => s + i.profit, 0));

    ordens.push({
      id: `${dia.replace(/-/g, '')}-${investor.id}-${nDoInvestidor}`,
      numero: `${dia.replace(/-/g, '')}-${String(sequencia).padStart(3, '0')}`,
      referenceDate: dia,
      createdAt: criadoEm,
      investorId: investor.id,
      // Nome e e-mail ficam COPIADOS na ordem, nao so referenciados. Uma ordem
      // e um documento historico: se o cadastro do investidor mudar depois, a
      // ordem tem que continuar dizendo pra quem foi paga naquele dia.
      investorName: investor.name || '(sem nome)',
      investorEmail: (investor.email || '').trim() || null,
      // A chave PIX viaja com a ordem pra o resumo da madrugada ja trazer pra
      // onde mandar o dinheiro — sem isso o dono abre a ordem, depois abre o
      // cadastro do investidor, e faz isso uma vez por investidor todo dia.
      investorPix: (investor.pixKey || '').trim() || null,
      // O telefone segue pela mesma razao: e o que monta o link do WhatsApp
      // quando o envio automatico falha. Copiado, e nao consultado na hora, pra
      // a ordem continuar entregavel mesmo se o cadastro mudar depois.
      investorPhone: (investor.phone || '').trim() || null,
      kind: temVenda ? ORDEM_TIPO.PAGAMENTO : ORDEM_TIPO.ZERO,
      status: ORDEM_STATUS.PENDENTE,
      items: itens,
      totalAmount,
      totalProfit,
      paidAt: null,
      sentAt: null,
      sentError: null,
    });
  }

  return { ordens, semDono, referenceDate: dia };
}
