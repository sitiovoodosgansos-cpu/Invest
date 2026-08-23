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
  normalizeDay,
  investidorEncerrado,
  formatCurrency,
  formatPercent,
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
  // Venda acertada FORA do sistema — o caso classico e o historico de antes de
  // o sistema existir, ja pago a mao ao longo dos meses.
  //
  // Guardado como uma ordem, e nao numa lista separada de "ignorar", porque a
  // regra de "ja foi pago" e uma so: a venda esta dentro de alguma ordem. Um
  // segundo lugar dizendo a mesma coisa sairia de sincronia. E o documento
  // tambem registra QUANDO e por quem o acerto foi declarado, que e o que uma
  // conferencia futura vai querer saber.
  ACERTADA: 'settled',
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

// O nome do que foi vendido, SEM a especie.
//
// "Galinha Sedosa do Japao" vira "Sedosa do Japao". A especie sai porque quem
// le a lista ja sabe que e galinha, e a palavra repetida em toda linha ocupa
// justamente o espaco de quem diferencia as linhas — a raca e a variedade.
//
// Cai na descricao concatenada quando nao ha raca separada: e o caso do
// lancamento manual, que e texto livre e nao tem lote por tras.
export function nomeDaVenda(venda) {
  const curto = [venda?.breedName, venda?.varietyName].filter(Boolean).join(' ').trim();
  return curto || venda?.description || '(sem descricao)';
}

// Como chamar a data de origem, por tipo. Sao verbos diferentes porque sao
// eventos diferentes: dizer "nasceu" de um ovo, ou de uma ave comprada pronta,
// seria simplesmente falso.
export const ROTULO_ORIGEM = {
  birth: 'nasceu',
  purchase: 'entrou',
  collected: 'coletado',
};

function dataCurta(dia) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || ''))) return '';
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

// A origem de uma linha em texto: "coletado 07/08/2026".
//
// Numa linha agrupada vira um periodo — "coletado 07/08 a 09/08/2026" — porque
// os ovos somados foram coletados em dias diferentes. Quando as duas pontas
// caem no mesmo ano, o ano so aparece no fim: repeti-lo nas duas so gasta a
// largura de uma coluna estreita de PDF.
//
// Linha antiga, emitida antes de a origem existir, nao tem o campo e devolve
// travessao em vez de "undefined" — a ordem e congelada na emissao e nunca vai
// ganhar origem depois.
export function textoOrigem(item) {
  const de = item?.originFrom || item?.originDate;
  if (!de) return '—';
  const ate = item?.originTo || de;
  const rotulo = ROTULO_ORIGEM[item?.originKind] || 'de';
  if (de === ate) return `${rotulo} ${dataCurta(de)}`;
  const inicio = de.slice(0, 4) === ate.slice(0, 4)
    ? dataCurta(de).slice(0, 5)
    : dataCurta(de);
  return `${rotulo} ${inicio} a ${dataCurta(ate)}`;
}

// O QUE foi vendido, contado: "18 ovos", "2 aves", "1 ovo".
//
// Conta a MERCADORIA, e nao quantas linhas do razao a linha somou. Sao numeros
// diferentes — tres bandejas de seis ovos sao uma venda de dezoito ovos — e o
// unico dos dois que o investidor consegue conferir contra o que recebeu e a
// quantidade.
//
// Devolve vazio quando nao ha quantidade: o lancamento manual do Ornabird e
// texto livre e nao diz quantas unidades sao, e "0 ovos" seria pior que nada.
export function contarMercadoria(item) {
  const n = Number(item?.quantity) || 0;
  if (n <= 0) return '';
  if (item?.isEgg) return `${n} ${n === 1 ? 'ovo' : 'ovos'}`;
  return `${n} ${n === 1 ? 'ave' : 'aves'}`;
}

// AGRUPAR AS LINHAS QUE O INVESTIDOR LE.
//
// O Ornabird registra uma venda de ovos por BANDEJA de origem: um pedido com
// ovos coletados em 07/08, 08/08 e 09/08 vira tres itens, cada um com a sua
// data de coleta. Isso esta certo la — e o controle de estoque, e e justamente
// de onde sai a data de origem que aparece na linha. Mas no documento do
// investidor viram tres linhas da MESMA galinha, no mesmo dia, com o valor
// quebrado em tres pedacos que ele tem que somar de cabeca.
//
// Entao o documento agrupa. O que ele NAO faz e agrupar o `items` da ordem: o
// razao e a propria ordem — uma venda esta paga porque o `saleId` dela aparece
// em `items` (veja vendasJaEmOrdem). Fundir duas linhas ali perderia um
// saleId, e a venda perdida voltaria pra fila de pendentes pra ser paga de
// novo. Agrupar e enfeite de apresentacao; o razao continua venda a venda.
//
// A REGRA DA CHAVE: so junta o que sairia identico em toda coluna mostrada.
// Somamos valor, lucro e quantidade, e transformamos a origem num periodo —
// todo o resto tem que bater. Por isso entram na chave campos que nem sempre
// vao pro PDF (cliente, lote, vinculo por titulo): eles aparecem na tela, e
// uma linha somada que mostrasse o cliente de um dos pedacos estaria mentindo.
export function agruparItens(itens) {
  const grupos = new Map();

  for (const item of Array.isArray(itens) ? itens : []) {
    // JSON.stringify e nao join: um separador qualquer pode aparecer DENTRO de
    // um campo de texto livre, e ai duas linhas diferentes gerariam a mesma
    // chave e seriam somadas por engano. O stringify escapa por conta propria.
    const chave = JSON.stringify([
      item?.birdId ?? '',
      item?.description ?? '',
      item?.isEgg ? 'ovo' : 'ave',
      item?.rate ?? '',
      // O valor fixo por ave tambem vai impresso, entao duas linhas com valores
      // diferentes nao podem virar uma — a celula mostraria o valor de uma das
      // duas e o total nao fecharia com a multiplicacao.
      item?.comissaoPorAve ?? '',
      // A data da VENDA fica na chave: duas vendas do mesmo lote em dias
      // diferentes sao dois eventos, e o investidor confere dia a dia.
      item?.date ?? '',
      item?.customer ?? '',
      item?.originKind ?? '',
      item?.matchedBy ?? '',
      item?.source ?? '',
    ]);

    const atual = grupos.get(chave);
    if (!atual) {
      grupos.set(chave, {
        ...item,
        // Quantas vendas do razao esta linha representa. Vai impresso quando e
        // mais de uma, pra a contagem de vendas da capa fechar com o detalhe.
        vendas: 1,
        saleIds: item?.saleId ? [item.saleId] : [],
        originFrom: item?.originDate || null,
        originTo: item?.originDate || null,
      });
      continue;
    }

    atual.vendas += 1;
    if (item?.saleId) atual.saleIds.push(item.saleId);
    atual.amount = arredondar((Number(atual.amount) || 0) + (Number(item?.amount) || 0));
    // O lucro e a SOMA dos lucros ja arredondados, e nao a taxa aplicada de
    // novo sobre o bruto somado: o total da ordem tambem e a soma das linhas,
    // e recalcular aqui abriria um centavo de diferenca entre a tabela e o
    // total impresso logo abaixo dela.
    atual.profit = arredondar((Number(atual.profit) || 0) + (Number(item?.profit) || 0));

    const somaQuantidade = (Number(atual.quantity) || 0) + (Number(item?.quantity) || 0);
    atual.quantity = somaQuantidade > 0 ? somaQuantidade : null;
    // Precos unitarios diferentes nao tem media que signifique alguma coisa.
    if (atual.unitPrice !== (item?.unitPrice ?? null)) atual.unitPrice = null;

    const dia = item?.originDate || null;
    if (dia) {
      if (!atual.originFrom || dia < atual.originFrom) atual.originFrom = dia;
      if (!atual.originTo || dia > atual.originTo) atual.originTo = dia;
      // Mantido pra quem le so `originDate`: aponta pra ponta mais antiga.
      atual.originDate = atual.originFrom;
    }
  }

  return [...grupos.values()];
}

// ---------------------------------------------------------------------------
// A COMISSAO: o ovo e a base, a ave vale quatro ovos
// ---------------------------------------------------------------------------
//
// O modelo antigo pagava um percentual sobre o preco de venda dos DOIS. Isso
// quebra na ave, e o motivo e do negocio, nao do software: o lucro liquido da
// ave e pre-fixado, mas o preco dela sobe com a idade porque manejo e racao vao
// se acumulando. Um percentual sobre um preco que sobe faz a comissao subir
// junto, sem que tenha havido mais lucro pra dividir — o investidor de uma ave
// vendida com seis meses recebia mais que o de uma ave identica vendida com um,
// pelo mesmo lucro.
//
// A regra nova ancora tudo no ovo:
//
//     comissao da ave = MULTIPLICADOR x (percentual do ovo x preco do ovo)
//
// Com o padrao de quatro: uma ave vale quatro ovos daquele mesmo lote. O dono
// so precisa escolher o percentual do ovo, e ele varia por lote justamente
// porque a postura varia — Brahma bota muito e leva 10%; Pavao Branco bota
// pouco e leva 32%, pra a conta dos quatro ovos chegar num numero justo.
//
//     Brahma:       ovo R$  24,00 x 10%  = R$  2,40  ->  ave = R$   9,60
//     Pavao Branco: ovo R$ 180,00 x 32%  = R$ 57,60  ->  ave = R$ 230,40
//
// O OVO CONTINUA PERCENTUAL sobre o valor da venda: ali o preco de venda ja e
// o proprio lucro proporcional, e nao carrega custo de idade nenhum.
export const MULTIPLICADOR_AVE_PADRAO = 4;

function numeroValido(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

export function getMultiplicadorAve(rates) {
  return numeroValido(rates?.multiplicadorAve) ? rates.multiplicadorAve : MULTIPLICADOR_AVE_PADRAO;
}

// O percentual do lote. E UM SO — o do ovo — e vale pros dois tipos de venda,
// porque a comissao da ave e derivada dele. `birdProfitRate` continua guardado
// nas linhas antigas, mas nao entra mais em conta nenhuma nova.
export function percentualDoOvo(bird, rates) {
  const override = bird?.eggProfitRate;
  if (typeof override === 'number' && isFinite(override) && override >= 0) return override;
  const global = rates?.eggProfitRate;
  return typeof global === 'number' && isFinite(global) && global >= 0 ? global : 0.10;
}

// O ultimo preco de ovo praticado em cada lote.
//
// Nao existe cadastro de "preco do ovo" em lugar nenhum — nem no Ornabird: o
// preco do ovo so aparece na hora da venda, no unitPrice do item. Entao o preco
// de referencia sai da propria historia do lote, e varre TODAS as vendas
// espelhadas (inclusive as ja pagas), porque um lote pode ter vendido ovo em
// maio e so ave agora.
export function indicePrecoOvo(vendas, resolverLote) {
  const porLote = new Map();
  for (const venda of Array.isArray(vendas) ? vendas : []) {
    if (!venda?.isEgg) continue;
    const preco = Number(venda.unitPrice);
    if (!numeroValido(preco)) continue;
    const bird = resolverLote(venda);
    if (!bird?.id) continue;
    const dia = normalizeDay(venda.date) || '';
    const atual = porLote.get(bird.id);
    // O MAIS RECENTE, e nao a media: a media de um lote que subiu de preco
    // ficaria eternamente atras do preco de hoje.
    if (!atual || dia >= atual.dia) porLote.set(bird.id, { dia, preco });
  }
  return porLote;
}

// De onde sai o preco do ovo daquele lote, em ordem de confianca.
//
// O que o dono digitou no lote ganha de tudo: e a decisao explicita dele, e o
// unico jeito de um lote que NUNCA vendeu ovo pagar comissao de ave. Sem isso,
// uma ave de um lote sem historico de ovo pagaria zero em silencio — que e
// exatamente o tipo de erro caro que este sistema nao pode ter.
export function precoOvoDoLote(bird, rates, indice) {
  if (numeroValido(bird?.precoOvoReferencia)) {
    return { preco: bird.precoOvoReferencia, fonte: 'lote' };
  }
  const observado = bird?.id ? indice?.get(bird.id) : null;
  if (observado && numeroValido(observado.preco)) {
    return { preco: observado.preco, fonte: 'venda', dia: observado.dia || null };
  }
  if (numeroValido(rates?.precoOvoReferencia)) {
    return { preco: rates.precoOvoReferencia, fonte: 'geral' };
  }
  return { preco: null, fonte: null };
}

// Quanto aquela venda rende pro investidor.
//
// Devolve `semReferencia` em vez de zero quando a ave nao tem preco de ovo pra
// se apoiar. Zero seria um numero, e um numero passa despercebido; a venda
// precisa ficar de fora da fila e aparecer num aviso.
export function comissaoDaVenda({ venda, bird, rates, indice }) {
  const amount = Number(venda?.amount) || 0;
  const rate = percentualDoOvo(bird, rates);

  if (venda?.isEgg) {
    return { isEgg: true, rate, profit: arredondar(amount * rate), semReferencia: false };
  }

  const { preco, fonte } = precoOvoDoLote(bird, rates, indice);
  const multiplicador = getMultiplicadorAve(rates);
  if (!numeroValido(preco)) {
    return { isEgg: false, rate, profit: 0, semReferencia: true, multiplicador };
  }

  const comissaoPorAve = arredondar(multiplicador * rate * preco);
  // Venda sem quantidade e o lancamento manual, que e texto livre. Uma ave e o
  // palpite menos errado, e a linha ja vai marcada como vinculo incerto.
  const aves = Number(venda?.quantity) > 0 ? Number(venda.quantity) : 1;
  return {
    isEgg: false,
    rate,
    precoOvo: preco,
    fontePrecoOvo: fonte,
    multiplicador,
    comissaoPorAve,
    profit: arredondar(aves * comissaoPorAve),
    semReferencia: false,
  };
}

// COMO aquela linha foi calculada, numa celula de tabela.
//
// "10%" pra ovo, "R$ 9,60/ave" pra ave. A coluna nao pode dizer "6,4%" numa
// linha de ave: a comissao dela nao e percentual do preco de venda, e um
// investidor que multiplicasse 6,4% por R$ 250 nao chegaria no valor pago —
// e ligaria pra perguntar quem estava errado.
//
// Linha ANTIGA, emitida no modelo de percentual, nao tem comissaoPorAve e cai
// no percentual. E o certo: aquele documento foi calculado assim mesmo.
export function textoComissao(item) {
  if (!item?.isEgg && numeroValido(item?.comissaoPorAve)) {
    return `${formatCurrency(item.comissaoPorAve)}/ave`;
  }
  return formatPercent(item?.rate ?? 0);
}

// A conta da linha por extenso: "10% de R$ 90,00", "R$ 9,60 por ave x 2".
//
// Mora aqui, e nao em cada tela, porque o cartao da ordem, o PDF, o WhatsApp e
// o e-mail mostram a MESMA conta. Se cada um montasse a sua, um deles ficaria
// pra tras numa mudanca de regra e o investidor receberia duas explicacoes
// diferentes do mesmo pagamento.
export function textoDaConta(item) {
  const porAve = Number(item?.comissaoPorAve);
  if (!item?.isEgg && porAve > 0) {
    const aves = Number(item?.quantity) > 0 ? Number(item.quantity) : 1;
    return aves > 1
      ? `${formatCurrency(porAve)} por ave x ${aves}`
      : `${formatCurrency(porAve)} por ave`;
  }
  return `${formatPercent(item?.rate)} de ${formatCurrency(item?.amount)}`;
}

// Uma linha da ordem, a partir de uma venda espelhada do Ornabird.
function montarItem(venda, bird, comissao) {
  const amount = Number(venda.amount) || 0;
  const { rate } = comissao;
  return {
    saleId: venda.id,
    // Data de NEGOCIO da venda, nao a data da rodada. Uma venda retroativa sai
    // numa ordem de hoje mostrando o dia em que de fato aconteceu.
    date: normalizeDay(venda.date) || null,
    // O nome curto (raca + variedade) e o que vai pra tela e pro PDF. A
    // descricao concatenada segue junto porque a ordem e um documento
    // historico: se o cadastro do lote mudar depois, o texto original ainda
    // esta la pra uma conferencia entender do que se tratava.
    description: nomeDaVenda(venda),
    descriptionOriginal: venda.description || null,
    speciesName: venda.speciesName ?? null,
    breedName: venda.breedName ?? null,
    varietyName: venda.varietyName ?? null,
    // Data de origem: quando a ave nasceu, quando entrou comprada, ou quando o
    // ovo foi coletado. `originKind` diz qual dos tres, pro rotulo nao mentir.
    originDate: normalizeDay(venda.originDate) || null,
    originKind: venda.originKind ?? null,
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
    // TUDO que forma o numero fica CONGELADO na linha: o percentual, o preco de
    // ovo usado como referencia e o multiplicador. Se o dono mudar qualquer um
    // deles depois, uma ordem ja emitida nao pode mudar de valor sozinha — e a
    // mesma regra que as vendas importadas ja seguem com o profitRate delas.
    //
    // E nao e so o valor: e a EXPLICACAO. Sem o preco do ovo guardado aqui, uma
    // ordem reaberta daqui a um ano mostraria "R$ 9,60 por ave" sem nada que
    // permitisse remontar de onde saiu o 9,60.
    rate,
    precoOvo: comissao.precoOvo ?? null,
    fontePrecoOvo: comissao.fontePrecoOvo ?? null,
    multiplicadorAve: comissao.multiplicador ?? null,
    comissaoPorAve: comissao.comissaoPorAve ?? null,
    profit: comissao.profit,
  };
}

// Tudo que ainda nao foi pago, ja atribuido ao dono e com o lucro calculado.
//
// E a MESMA conta que a ordem faz — de proposito. A tela de pendentes existe
// pra o dono conferir antes de emitir; se ela calculasse por conta propria, o
// numero conferido e o numero pago seriam dois numeros diferentes, e a
// conferencia nao valeria nada.
//
// `semDono` NAO e descartado: venda sem lote vinculado e dinheiro que alguem
// pode estar esperando, e sumir com ela em silencio e exatamente o modo de
// falha que este sistema nao pode ter. Volta pro chamador mostrar na tela.
export function listarPendentes({
  vendas,
  birds,
  investors,
  rates,
  ordensExistentes = [],
  // Quando vem preenchido, so estas vendas sao consideradas — e o que permite
  // ao dono escolher a dedo o que entra numa ordem.
  saleIds = null,
}) {
  const jaPagas = vendasJaEmOrdem(ordensExistentes);
  const groupIndex = buildOrnabirdGroupIndex(birds);
  const investidores = Array.isArray(investors) ? investors : [];
  const escolhidas = saleIds ? new Set(saleIds) : null;

  // O preco de referencia do ovo sai de TODAS as vendas espelhadas, e nao so
  // das que estao nesta varredura: um lote pode ter vendido ovo em maio, ja
  // pago, e so ave agora. Filtrar antes deixaria a ave sem referencia.
  const indice = indicePrecoOvo(vendas, (v) => resolveMirrorBird(v, groupIndex));

  const pendentes = [];
  const semDono = [];
  const semReferencia = [];

  for (const venda of Array.isArray(vendas) ? vendas : []) {
    if (!venda?.id || jaPagas.has(venda.id)) continue;
    if (escolhidas && !escolhidas.has(venda.id)) continue;
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

    const comissao = comissaoDaVenda({ venda, bird, rates, indice });

    // Ave de um lote que nunca vendeu ovo e sem preco de referencia digitado:
    // nao da pra derivar a comissao. Fica FORA da fila, num aviso proprio — se
    // entrasse valendo zero, o dono pagaria a ordem sem perceber que uma venda
    // foi rateada a zero, e o investidor e que descobriria depois.
    if (comissao.semReferencia) {
      semReferencia.push({
        saleId: venda.id,
        date: diaVenda || null,
        description: nomeDaVenda(venda),
        amount: arredondar(amount),
        birdName: bird?.breed || bird?.name || null,
        investorName: investor.name || '(sem nome)',
        motivo: 'lote sem preco de ovo pra derivar a comissao da ave',
      });
      continue;
    }

    pendentes.push({
      ...montarItem(venda, bird, comissao),
      investorId: investor.id,
      investorName: investor.name || '(sem nome)',
    });
  }

  // Da venda MAIS RECENTE pra mais antiga.
  //
  // A fila e uma tela de conferencia, nao um extrato: o que o dono precisa ver
  // primeiro e o que acabou de vender, porque e o que ele ainda nao conferiu.
  // Do jeito contrario, uma fila com mil vendas de historico abria em maio e o
  // dinheiro de ontem ficava a mil linhas de distancia.
  //
  // A ordem EMITIDA continua do mais antigo pro mais novo (ver construirOrdens):
  // la o documento se le como extrato, e extrato comeca no comeco.
  pendentes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { pendentes, semDono, semReferencia };
}

// Quanto cada investidor tem a receber pelas vendas do Ornabird, e quanto disso
// ja saiu.
//
// POR QUE ISTO EXISTE
// -------------------
// A tela de Aportes calcula o saldo do investidor como
// "rendimento + lucro de vendas - pagamentos". As vendas do Ornabird nao
// entravam nessa conta em canto nenhum: o lucro delas so aparecia na fila de
// pendentes, e uma ordem paga nao abatia nada. Pagar um investidor deixava o
// saldo dele exatamente onde estava.
//
// A IDENTIDADE QUE ISTO GARANTE
// -----------------------------
//   credito = pago + acertado + emAberto + pendente
//
// Ela vale por construcao porque cada parcela vem de um lugar diferente e
// mutuamente exclusivo: uma venda ou esta dentro de uma ordem (e ai o valor
// usado e o CONGELADO na linha da ordem, que foi o que de fato se pagou), ou
// ainda nao esta (e ai vale a taxa de hoje). Somar as duas fontes com a mesma
// taxa daria um numero que nao bate com o comprovante que o investidor tem na
// mao quando a taxa global mudar.
//
// O que entra no saldo em aberto e `emAberto + pendente`: o que ja foi pago ou
// acertado sai da conta, que e exatamente o pedido — o pagamento abate.
export function saldoOrnabird({ vendas, birds, investors, rates, ordens = [] }) {
  const porInvestidor = new Map();
  const pegar = (id) => {
    if (!porInvestidor.has(id)) {
      porInvestidor.set(id, { investorId: id, credito: 0, pago: 0, acertado: 0, emAberto: 0, pendente: 0 });
    }
    return porInvestidor.get(id);
  };

  for (const ordem of Array.isArray(ordens) ? ordens : []) {
    // Ordem cancelada nao conta em lugar nenhum: as vendas dela voltaram pra
    // fila e vao ser contadas como pendentes, pela mesma regra de vendasJaEmOrdem.
    if (ordem?.status === ORDEM_STATUS.CANCELADA) continue;
    const acerto = ordem?.kind === ORDEM_TIPO.ACERTADA;
    const paga = ordem?.status === ORDEM_STATUS.PAGA;

    for (const item of ordem?.items || []) {
      // No acerto o dono de cada venda esta na LINHA (um documento de acerto
      // carrega vendas de varios investidores). Na ordem de pagamento o dono e
      // do documento inteiro.
      const investorId = acerto ? item?.investorId : ordem?.investorId;
      if (!investorId) continue;
      const valor = Number(item?.profit) || 0;
      const alvo = pegar(investorId);
      if (acerto) alvo.acertado += valor;
      else if (paga) alvo.pago += valor;
      else alvo.emAberto += valor;
    }
  }

  const { pendentes } = listarPendentes({ vendas, birds, investors, rates, ordensExistentes: ordens });
  for (const p of pendentes) pegar(p.investorId).pendente += p.profit;

  const lista = [];
  for (const linha of porInvestidor.values()) {
    const pago = arredondar(linha.pago);
    const acertado = arredondar(linha.acertado);
    const emAberto = arredondar(linha.emAberto);
    const pendente = arredondar(linha.pendente);
    lista.push({
      ...linha,
      pago, acertado, emAberto, pendente,
      credito: arredondar(pago + acertado + emAberto + pendente),
      // O que ainda deve entrar no saldo do investidor.
      aPagar: arredondar(emAberto + pendente),
    });
  }
  return lista;
}

// Quantas vendas cabem num documento de acerto.
//
// Um acerto de historico pode carregar mais de mil vendas de uma vez. Enfiadas
// num documento so, passariam do teto de 1 MiB do Firestore — o mesmo teto que
// ja engoliu gravacoes nesta base duas vezes, e que engole em SILENCIO: a
// gravacao e recusada e o backlog continua la, aparentemente sem motivo.
const VENDAS_POR_ACERTO = 300;

// Declara que um conjunto de vendas ja foi acertado fora do sistema.
//
// O caso que motivou isto: no primeiro uso, "tudo que ainda nao foi pago" e o
// historico inteiro do criatorio — centenas de vendas que o dono ja pagou a
// mao ao longo dos meses. Sem uma forma de dizer "isso ja esta quitado", ou
// elas viram uma ordem gigante de dinheiro que ja saiu, ou ficam pendentes
// para sempre atrapalhando a leitura da tela.
//
// Nao ha pagamento, nem e-mail, nem investidor destinatario: e um registro de
// que aquelas vendas nao devem mais entrar em ordem nenhuma.
export function construirAcerto({
  vendas,
  birds,
  investors,
  rates,
  ordensExistentes = [],
  saleIds,
  agora = new Date(),
  motivo = 'Acertado fora do sistema',
}) {
  const dia = diaBrasilia(agora);
  const criadoEm = (agora instanceof Date ? agora : new Date(agora)).toISOString();

  // Passa pela MESMA atribuicao das ordens: o registro do acerto guarda de
  // quem era cada venda, que e o que uma conferencia futura vai querer saber.
  const { pendentes, semDono, semReferencia } = listarPendentes({
    vendas, birds, investors, rates, ordensExistentes, saleIds,
  });

  // Venda sem dono tambem pode ser acertada — ela esta na fila do mesmo jeito,
  // e deixa-la de fora faria o backlog nunca zerar. Vale igual pra ave sem
  // preco de ovo: se ela nao pudesse ser acertada, ficaria pendurada pra
  // sempre, mesmo depois de o dono ja ter pago aquilo por fora.
  const linhas = [
    ...pendentes.map(p => ({
      saleId: p.saleId, date: p.date, description: p.description,
      amount: p.amount, profit: p.profit,
      investorId: p.investorId, investorName: p.investorName,
    })),
    ...semDono.map(v => ({
      saleId: v.saleId, date: v.date, description: v.description,
      amount: v.amount, profit: 0,
      investorId: null, investorName: null,
    })),
    ...semReferencia.map(v => ({
      saleId: v.saleId, date: v.date, description: v.description,
      amount: v.amount, profit: 0,
      investorId: null, investorName: v.investorName || null,
    })),
  ];

  const documentos = [];
  for (let i = 0; i < linhas.length; i += VENDAS_POR_ACERTO) {
    const fatia = linhas.slice(i, i + VENDAS_POR_ACERTO);
    const parte = Math.floor(i / VENDAS_POR_ACERTO) + 1;
    documentos.push({
      id: `acerto-${dia.replace(/-/g, '')}-${parte}-${criadoEm.slice(11, 19).replace(/:/g, '')}`,
      numero: `ACERTO-${dia.replace(/-/g, '')}-${String(parte).padStart(3, '0')}`,
      referenceDate: dia,
      createdAt: criadoEm,
      investorId: null,
      investorName: motivo,
      investorEmail: null,
      investorPix: null,
      investorPhone: null,
      kind: ORDEM_TIPO.ACERTADA,
      // Nunca entra na fila de pagar nem no envio: nao ha o que pagar.
      status: ORDEM_STATUS.PAGA,
      items: fatia,
      totalAmount: arredondar(fatia.reduce((s, l) => s + l.amount, 0)),
      totalProfit: arredondar(fatia.reduce((s, l) => s + l.profit, 0)),
      paidAt: criadoEm,
      sentAt: null,
      sentError: null,
      motivo,
    });
  }

  return { documentos, total: linhas.length };
}

// Monta as ordens de uma rodada.
//
// Entra: as vendas espelhadas do Ornabird, o Plantel, os investidores, as
// taxas globais e as ordens que ja existem. Sai: uma ordem por investidor com
// venda nova, um aviso por investidor sem venda, e a lista das vendas que nao
// caem em investidor nenhum.
//
// `saleIds` restringe a quais vendas entram. Sem ele, entra tudo que esta
// pendente (o comportamento da rotina das 6h); com ele, so as escolhidas na
// tela.
//
// `comAvisoZero` desliga os avisos de "nao vendeu nada hoje". Numa emissao
// manual eles nao fazem sentido: o dono escolheu vendas especificas, e quem
// ficou de fora nao ficou porque nao vendeu.
export function construirOrdens({
  vendas,
  birds,
  investors,
  rates,
  ordensExistentes = [],
  referenceDate = null,
  agora = new Date(),
  saleIds = null,
  comAvisoZero = true,
}) {
  const dia = referenceDate || diaBrasilia(agora);
  const criadoEm = (agora instanceof Date ? agora : new Date(agora)).toISOString();
  const investidores = Array.isArray(investors) ? investors : [];

  const { pendentes, semDono, semReferencia } = listarPendentes({
    vendas, birds, investors, rates, ordensExistentes, saleIds,
  });

  const porInvestidor = new Map();
  for (const item of pendentes) {
    const { investorId, investorName: _nome, ...linha } = item;
    if (!porInvestidor.has(investorId)) porInvestidor.set(investorId, []);
    porInvestidor.get(investorId).push(linha);
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

    // Numa emissao manual nao ha aviso de zero vendas: quem ficou de fora
    // ficou porque o dono nao escolheu as vendas dele, e nao porque nao vendeu.
    if (!temVenda && !comAvisoZero) continue;

    // Quem encerrou a participacao nao recebe "que tal comprar mais aves?" —
    // seria um convite diario pra quem acabou de sair. Mas repare que isto so
    // desliga o AVISO: se ainda houver venda dele em aberto, a ordem de
    // pagamento sai normalmente. Dinheiro devido nao deixa de ser devido
    // porque a sociedade acabou.
    if (!temVenda && investidorEncerrado(investor)) continue;

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

  return { ordens, semDono, semReferencia, referenceDate: dia };
}
