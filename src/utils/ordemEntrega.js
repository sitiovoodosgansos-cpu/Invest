// Entregar a ordem de pagamento SEM o Resend.
//
// O envio automático depende de um serviço de terceiros, e serviço de terceiro
// cai. Quando isso acontecer, o dinheiro já saiu e o investidor está sem o
// comprovante — então precisa existir um caminho que não dependa de servidor
// nenhum. Tudo aqui roda no navegador: monta o texto, monta o PDF, e abre o
// WhatsApp ou o programa de e-mail JÁ PREENCHIDOS.
//
// A diferença que importa: o e-mail daqui sai da conta DO DONO, não do Resend.
// É por isso que isto é uma alternativa de verdade e não outro caminho para o
// mesmo ponto de falha.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, formatPercent } from './helpers.js';
import { ROTULO_ORIGEM } from './ordens.js';

const ROXO = [108, 43, 217];
const TINTA = [30, 27, 75];
const CINZA = [100, 116, 139];

function dataBr(iso) {
  const dia = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return '—';
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

// A origem em uma coluna estreita de PDF: "nasceu 10/05/2026".
//
// Linha antiga (emitida antes de a origem existir) nao tem o campo — devolve
// travessao em vez de "undefined", que e o que uma ordem historica reaberta
// mostraria.
function origemCurta(item) {
  if (!item?.originDate) return '—';
  return `${ROTULO_ORIGEM[item.originKind] || 'de'} ${dataBr(item.originDate)}`;
}

// ---------------------------------------------------------------------------
// Texto puro
//
// Uma versão só, usada pelo WhatsApp, pelo e-mail e pelo botão de copiar. Se
// cada canal tivesse o seu, um deles ficaria desatualizado e o investidor
// receberia contas diferentes dependendo de por onde a ordem chegou.
// ---------------------------------------------------------------------------

export function textoDaOrdem(ordem) {
  if (!ordem) return '';

  if (ordem.kind === 'zero') {
    return [
      `Ola, ${ordem.investorName}.`,
      '',
      `Hoje nao houve venda das suas aves, entao nao ha valor a receber referente a ${dataBr(ordem.referenceDate)}.`,
      '',
      'Quanto mais aves voce tem no plantel, mais linhas entram no rateio de cada dia.',
      'Se quiser aumentar sua participacao, e so responder esta mensagem.',
      '',
      'Sitio Voo dos Gansos',
    ].join('\n');
  }

  const linhas = (ordem.items || []).map(i => {
    const origem = i.originDate ? `, ${origemCurta(i)}` : '';
    return `- ${i.description} (${i.isEgg ? 'ovos' : 'ave'}${origem}) `
      + `vendida em ${dataBr(i.date)}: ${formatPercent(i.rate)} de `
      + `${formatCurrency(i.amount)} = ${formatCurrency(i.profit)}`;
  });

  return [
    `Ola, ${ordem.investorName}.`,
    '',
    `Pagamento referente a ${dataBr(ordem.referenceDate)} — ordem ${ordem.numero}.`,
    '',
    'Vendas:',
    ...linhas,
    '',
    `TOTAL PAGO: ${formatCurrency(ordem.totalProfit)}`,
    `(valor bruto das vendas: ${formatCurrency(ordem.totalAmount)})`,
    '',
    'Seu lucro e o percentual acordado sobre o valor bruto de cada venda,',
    'calculado linha a linha.',
    '',
    'Sitio Voo dos Gansos',
  ].join('\n');
}

// O resumo do dia, para o próprio dono. Serve quando o e-mail das 6h não sai.
export function textoDoDia(ordens, referenceDate) {
  const aPagar = (ordens || []).filter(o => o.kind !== 'zero');
  const total = aPagar.reduce((s, o) => s + (Number(o.totalProfit) || 0), 0);

  return [
    `Ordens de pagamento — ${dataBr(referenceDate)}`,
    '',
    ...aPagar.map(o =>
      `- ${o.investorName}: ${formatCurrency(o.totalProfit)}`
      + `${o.investorPix ? ` (PIX ${o.investorPix})` : ' (sem chave PIX cadastrada)'}`
    ),
    aPagar.length === 0 ? '- Nenhuma venda nova desde a ultima rodada.' : '',
    '',
    `TOTAL: ${formatCurrency(total)}`,
  ].filter(l => l !== '').join('\n');
}

// ---------------------------------------------------------------------------
// WhatsApp e e-mail
// ---------------------------------------------------------------------------

// Telefone no formato que o wa.me exige: só dígitos, com o país na frente.
//
// O cadastro guarda como a pessoa digitou — "(11) 99999-9999", "11 99999 9999".
// Sem normalizar, o link abre o WhatsApp num número inexistente e a mensagem
// se perde sem erro nenhum. Devolve null quando não dá pra ter certeza, e aí a
// tela esconde o botão em vez de oferecer um caminho quebrado.
export function telefoneWhatsapp(bruto) {
  const digitos = String(bruto || '').replace(/\D/g, '');
  if (!digitos) return null;
  // 10 (fixo com DDD) ou 11 (celular com DDD) = número nacional, falta o 55.
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  // Já veio com o país.
  if (digitos.length === 12 || digitos.length === 13) return digitos;
  return null;
}

export function linkWhatsapp(ordem) {
  const fone = telefoneWhatsapp(ordem?.investorPhone);
  if (!fone) return null;
  return `https://wa.me/${fone}?text=${encodeURIComponent(textoDaOrdem(ordem))}`;
}

// Limite conservador para o mailto:.
//
// O Windows corta a linha de comando em 2048 caracteres, e um mailto: mais
// longo que isso chega ao programa de e-mail com o corpo truncado NO MEIO —
// o investidor receberia meia ordem, sem nada indicando que faltou pedaço.
// Passando disso, mandamos só o resumo e o PDF vai anexado à mão.
const LIMITE_MAILTO = 1800;

export function linkEmail(ordem) {
  const destino = (ordem?.investorEmail || '').trim();
  if (!destino) return null;

  const assunto = ordem.kind === 'zero'
    ? `Nenhuma venda em ${dataBr(ordem.referenceDate)}`
    : `Pagamento enviado - ordem ${ordem.numero}`;

  const completo = textoDaOrdem(ordem);
  const resumido = [
    `Ola, ${ordem.investorName}.`,
    '',
    `Pagamento referente a ${dataBr(ordem.referenceDate)} — ordem ${ordem.numero}.`,
    `${(ordem.items || []).length} venda(s).`,
    '',
    `TOTAL PAGO: ${formatCurrency(ordem.totalProfit)}`,
    '',
    'O detalhamento de cada venda vai no PDF em anexo.',
    '',
    'Sitio Voo dos Gansos',
  ].join('\n');

  const montar = (corpo) =>
    `mailto:${encodeURIComponent(destino)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;

  const link = montar(completo);
  return {
    href: link.length <= LIMITE_MAILTO ? link : montar(resumido),
    // A tela avisa quando o corpo foi encurtado, pra o dono lembrar de anexar
    // o PDF antes de mandar.
    resumido: link.length > LIMITE_MAILTO,
  };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function cabecalho(doc, titulo, subtitulo) {
  const largura = doc.internal.pageSize.getWidth();
  doc.setFillColor(...ROXO);
  doc.rect(0, 0, largura, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Sitio Voo dos Gansos', 14, 16);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(titulo, 14, 26);
  if (subtitulo) {
    doc.setFontSize(10);
    doc.text(subtitulo, largura - 14, 26, { align: 'right' });
  }
}

// Nome de arquivo previsível e sem acento: vira anexo de e-mail e nome de
// arquivo no WhatsApp, e ali acento e barra quebram em alguns sistemas.
function nomeArquivo(...partes) {
  return partes
    .join('-')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase() + '.pdf';
}

export function pdfDaOrdem(ordem) {
  const doc = new jsPDF();
  const largura = doc.internal.pageSize.getWidth();

  const ehAviso = ordem.kind === 'zero';
  cabecalho(
    doc,
    ehAviso ? 'Aviso — sem vendas no dia' : 'Ordem de pagamento',
    ehAviso ? '' : `Ordem ${ordem.numero}`
  );

  let y = 54;
  doc.setTextColor(...TINTA);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(ordem.investorName || 'Investidor', 14, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...CINZA);
  doc.text(`Referente a ${dataBr(ordem.referenceDate)}`, 14, y);
  if (ordem.investorEmail) doc.text(ordem.investorEmail, largura - 14, y, { align: 'right' });
  y += 12;

  if (ehAviso) {
    doc.setTextColor(...TINTA);
    doc.setFontSize(11);
    const texto = doc.splitTextToSize(
      'Nao houve venda das suas aves nesta data, entao nao ha valor a receber. '
      + 'Quanto mais aves voce tem no plantel, mais linhas entram no rateio de cada dia.',
      largura - 28
    );
    doc.text(texto, 14, y);
    doc.save(nomeArquivo('aviso', ordem.investorName, ordem.referenceDate));
    return;
  }

  autoTable(doc, {
    startY: y,
    // A data da VENDA fica no PDF, ainda que tenha saido da fila na tela: este
    // e o documento que o investidor confere contra o extrato dele.
    head: [['Venda', 'Tipo', 'Origem', 'Data', 'Valor bruto', 'Taxa', 'Seu lucro']],
    body: (ordem.items || []).map(i => [
      i.description,
      i.isEgg ? 'Ovos' : 'Ave',
      origemCurta(i),
      dataBr(i.date),
      formatCurrency(i.amount),
      formatPercent(i.rate),
      formatCurrency(i.profit),
    ]),
    theme: 'striped',
    headStyles: { fillColor: ROXO, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 12;
  doc.setTextColor(...TINTA);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Total pago', 14, y);
  doc.text(formatCurrency(ordem.totalProfit), largura - 14, y, { align: 'right' });

  y += 10;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...CINZA);
  doc.text(
    `Valor bruto das vendas: ${formatCurrency(ordem.totalAmount)}. `
    + 'Seu lucro e o percentual acordado sobre o valor bruto de cada venda, calculado linha a linha.',
    14, y, { maxWidth: largura - 28 }
  );

  doc.save(nomeArquivo('ordem', ordem.numero, ordem.investorName));
}

// Todas as ordens do dia num PDF só — o que o dono usa pra pagar.
export function pdfDoDia(ordens, referenceDate) {
  const doc = new jsPDF();
  const largura = doc.internal.pageSize.getWidth();

  cabecalho(doc, 'Ordens de pagamento do dia', dataBr(referenceDate));

  const aPagar = (ordens || []).filter(o => o.kind !== 'zero');
  const total = aPagar.reduce((s, o) => s + (Number(o.totalProfit) || 0), 0);

  autoTable(doc, {
    startY: 54,
    head: [['Investidor', 'Chave PIX', 'Vendas', 'Bruto', 'A pagar']],
    body: aPagar.length > 0
      ? aPagar.map(o => [
          o.investorName,
          // Dizer que falta e mais util que uma celula vazia: sem chave, o
          // pagamento trava e o dono precisa saber disso ANTES de sentar pra
          // pagar, nao no meio.
          o.investorPix || '(sem chave cadastrada)',
          String((o.items || []).length),
          formatCurrency(o.totalAmount),
          formatCurrency(o.totalProfit),
        ])
      : [['Nenhuma venda nova desde a ultima rodada.', '', '', '', '']],
    theme: 'striped',
    headStyles: { fillColor: ROXO, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  let y = doc.lastAutoTable.finalY + 12;
  doc.setTextColor(...TINTA);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Total do dia', 14, y);
  doc.text(formatCurrency(total), largura - 14, y, { align: 'right' });

  // O detalhe de cada ordem, uma por pagina. E o que transforma este PDF em
  // comprovante e nao so numa lista de valores.
  for (const ordem of aPagar) {
    doc.addPage();
    cabecalho(doc, `Ordem ${ordem.numero}`, ordem.investorName);
    autoTable(doc, {
      startY: 54,
      head: [['Venda', 'Tipo', 'Origem', 'Data', 'Valor bruto', 'Taxa', 'Lucro']],
      body: (ordem.items || []).map(i => [
        i.description, i.isEgg ? 'Ovos' : 'Ave', origemCurta(i),
        dataBr(i.date), formatCurrency(i.amount),
        formatPercent(i.rate), formatCurrency(i.profit),
      ]),
      theme: 'striped',
      headStyles: { fillColor: ROXO, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 10;
    doc.setTextColor(...TINTA);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Total', 14, y);
    doc.text(formatCurrency(ordem.totalProfit), largura - 14, y, { align: 'right' });
  }

  doc.save(nomeArquivo('ordens', referenceDate));
}
