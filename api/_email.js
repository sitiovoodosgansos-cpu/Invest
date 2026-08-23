// Envio de e-mail pelo Resend, e os dois modelos de mensagem.
//
// Sao duas mensagens diferentes, com finalidades opostas:
//
//   * o RESUMO DO DIA, que sai de madrugada para o dono. E uma lista de
//     tarefas: aqui esta o que voce tem a pagar hoje.
//   * a ORDEM DO INVESTIDOR, que sai depois que o dono pagou. E um recibo:
//     este dinheiro ja saiu, e aqui esta a conta que deu nele.
//
// Escrever as duas com o mesmo texto seria o erro classico deste tipo de
// sistema — o investidor receberia um "a pagar" e ficaria esperando um
// dinheiro que ja esta na conta dele.

const RESEND_URL = 'https://api.resend.com/emails';

export function emailConfigurado() {
  return Boolean(process.env.RESEND_API_KEY && process.env.ORDEM_EMAIL_FROM);
}

// Manda um e-mail. NUNCA levanta excecao por falta de configuracao: no dia em
// que o Resend ainda nao estiver ligado, a rotina das 6h precisa continuar
// gerando as ordens — elas ficam na tela do mesmo jeito. So o aviso deixa de
// sair, e o motivo volta aqui pra ser gravado na ordem.
export async function enviarEmail({ to, subject, html, replyTo }) {
  if (!process.env.RESEND_API_KEY) return { enviado: false, motivo: 'sem_resend_api_key' };
  if (!process.env.ORDEM_EMAIL_FROM) return { enviado: false, motivo: 'sem_remetente' };
  const destino = (to || '').trim();
  if (!destino) return { enviado: false, motivo: 'sem_destinatario' };

  let res;
  try {
    res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.ORDEM_EMAIL_FROM,
        to: [destino],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch {
    return { enviado: false, motivo: 'resend_inalcancavel' };
  }

  if (!res.ok) {
    // O corpo do Resend costuma dizer exatamente o que esta errado ("domain is
    // not verified", "invalid to field"), e sem isso a investigacao vira
    // adivinhacao. Nao carrega segredo: a chave vai no cabecalho, nao no corpo.
    const detalhe = await res.text().catch(() => '');
    return {
      enviado: false,
      motivo: `resend_${res.status}`,
      detalhe: detalhe.slice(0, 300) || null,
    };
  }

  const corpo = await res.json().catch(() => ({}));
  return { enviado: true, id: corpo?.id ?? null };
}

// ---------------------------------------------------------------------------
// Modelos
//
// HTML de e-mail e HTML de 1999 de proposito: tabela, largura fixa, estilo
// escrito no atributo. Gmail e Outlook descartam <style> no topo e nao aplicam
// classe nenhuma, entao qualquer coisa mais moderna chegaria sem formatacao.
// ---------------------------------------------------------------------------

const TINTA = '#1b2237';
const SUAVE = '#6b7280';
const BORDA = '#e5e7eb';
const DESTAQUE = '#7a2e3b';

function dinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(Number(valor) || 0);
}

function dataBr(iso) {
  const dia = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return '—';
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

function percentual(taxa) {
  const v = (Number(taxa) || 0) * 100;
  return `${v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')}%`;
}

// Escapa texto vindo do cadastro e do Ornabird — nome de cliente, descricao de
// anuncio. Sem isso, um nome com "<" quebraria o layout do e-mail, e um nome
// com uma tag dentro entraria como marcacao no corpo da mensagem.
function esc(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function moldura(titulo, miolo) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px 12px;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:${TINTA}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid ${BORDA};border-radius:10px">
<tr><td style="padding:24px 24px 8px">
<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${SUAVE}">Sitio Voo dos Gansos</div>
<h1 style="margin:6px 0 0;font-size:20px;line-height:1.3;font-weight:600">${esc(titulo)}</h1>
</td></tr>
<tr><td style="padding:8px 24px 24px">${miolo}</td></tr>
</table>
<div style="max-width:600px;margin:12px auto 0;font-size:11px;line-height:1.5;color:${SUAVE};text-align:center">
Mensagem automatica do sistema de investidores. Duvida sobre um valor? Responda este e-mail.
</div>
</body></html>`;
}

// O periodo das VENDAS de uma ordem. Nao e a data da ordem: uma ordem emitida
// hoje pode pagar vendas de ontem, da semana passada, ou de varios dias juntos.
function periodoDasVendas(itens) {
  const dias = (itens || []).map(i => i?.date).filter(Boolean).sort();
  if (dias.length === 0) return null;
  const primeiro = dataBr(dias[0]);
  const ultimo = dataBr(dias[dias.length - 1]);
  return primeiro === ultimo ? primeiro : `${primeiro} a ${ultimo}`;
}

function linhasDaOrdem(itens) {
  return (itens || []).map(item => `<tr>
<td style="padding:8px 0;border-bottom:1px solid ${BORDA};font-size:13px;vertical-align:top">
  <div style="font-weight:500">${esc(item.description)}</div>
  <div style="color:${SUAVE};font-size:12px">${dataBr(item.date)}${item.quantity ? ` · ${item.quantity} un` : ''} · ${percentual(item.rate)} de ${dinheiro(item.amount)}</div>
</td>
<td style="padding:8px 0;border-bottom:1px solid ${BORDA};font-size:13px;text-align:right;white-space:nowrap;vertical-align:top">${dinheiro(item.profit)}</td>
</tr>`).join('');
}

// O recibo que o investidor recebe DEPOIS do pagamento.
export function htmlOrdemInvestidor(ordem) {
  if (ordem?.kind === 'zero') {
    return moldura('Nenhuma venda hoje', `
<p style="font-size:14px;line-height:1.6;margin:0 0 14px">Ola, ${esc(ordem.investorName)}.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px">Hoje nao houve venda das suas aves, entao nao ha valor a receber referente a ${dataBr(ordem.referenceDate)}.</p>
<p style="font-size:14px;line-height:1.6;margin:0 0 14px">Quanto mais aves voce tem no plantel, mais linhas entram no rateio de cada dia. Se quiser aumentar sua participacao, e so responder este e-mail que a gente mostra o que esta disponivel.</p>
<p style="font-size:13px;line-height:1.6;color:${SUAVE};margin:0">Ate amanha.</p>`);
  }

  const total = dinheiro(ordem?.totalProfit);
  // "Pagamento de DD/MM" e nao "referente a DD/MM": a segunda forma se le como
  // "vendas daquele dia", e as vendas de uma ordem podem ser de qualquer dia
  // anterior. O periodo delas vai logo em seguida, quando existe.
  const periodo = periodoDasVendas(ordem?.items);
  return moldura(`Pagamento enviado · ${total}`, `
<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Ola, ${esc(ordem.investorName)}. O pagamento de ${dataBr(ordem.referenceDate)} <strong>ja foi enviado</strong>.${periodo ? ` Ele cobre as vendas de ${periodo}.` : ''} Abaixo, o que entrou nele.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr>
<th align="left" style="padding:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${SUAVE};border-bottom:2px solid ${TINTA};font-weight:600">Venda</th>
<th align="right" style="padding:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${SUAVE};border-bottom:2px solid ${TINTA};font-weight:600">Seu lucro</th>
</tr>
${linhasDaOrdem(ordem?.items)}
<tr>
<td style="padding:14px 0 0;font-size:14px;font-weight:600">Total pago</td>
<td style="padding:14px 0 0;font-size:18px;font-weight:700;text-align:right;color:${DESTAQUE}">${total}</td>
</tr>
</table>

<p style="font-size:12px;line-height:1.6;color:${SUAVE};margin:18px 0 0">Ordem ${esc(ordem.numero)} · valor bruto das vendas ${dinheiro(ordem?.totalAmount)}. Seu lucro e o percentual acordado sobre o valor bruto de cada venda, calculado linha a linha.</p>`);
}

// A lista de tarefas que o dono recebe de madrugada.
export function htmlResumoAdmin({ referenceDate, ordens, semDono, avisos }) {
  const aPagar = (ordens || []).filter(o => o.kind !== 'zero');
  const total = aPagar.reduce((s, o) => s + (Number(o.totalProfit) || 0), 0);

  const linhas = aPagar.length
    ? aPagar.map(o => `<tr>
<td style="padding:9px 0;border-bottom:1px solid ${BORDA};font-size:14px">
  <div style="font-weight:500">${esc(o.investorName)}</div>
  <div style="color:${SUAVE};font-size:12px">${o.items.length} venda(s) · bruto ${dinheiro(o.totalAmount)}${o.investorPix ? ` · PIX ${esc(o.investorPix)}` : ''}</div>
</td>
<td style="padding:9px 0;border-bottom:1px solid ${BORDA};font-size:15px;font-weight:600;text-align:right;white-space:nowrap">${dinheiro(o.totalProfit)}</td>
</tr>`).join('')
    : `<tr><td colspan="2" style="padding:14px 0;font-size:14px;color:${SUAVE}">Nenhuma venda nova desde a ultima rodada.</td></tr>`;

  const alertas = [];
  if (semDono?.length) {
    alertas.push(`<strong>${semDono.length} venda(s) sem investidor.</strong> Sao vendas de lote que nao esta vinculado a nenhuma linha do Plantel — nao entraram em ordem nenhuma e ninguem vai receber por elas ate o vinculo ser feito.`);
  }
  for (const aviso of avisos || []) alertas.push(esc(aviso));

  return moldura(`Ordens de ${dataBr(referenceDate)} · ${dinheiro(total)}`, `
<p style="font-size:14px;line-height:1.6;margin:0 0 16px">${aPagar.length} ordem(ns) a pagar hoje. Depois de fazer os PIX, marque como pagas no Invest para que cada investidor receba o comprovante dele.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
${linhas}
<tr>
<td style="padding:14px 0 0;font-size:14px;font-weight:600">Total</td>
<td style="padding:14px 0 0;font-size:19px;font-weight:700;text-align:right;color:${DESTAQUE}">${dinheiro(total)}</td>
</tr>
</table>

${alertas.length ? `<div style="margin-top:20px;padding:12px 14px;background:#fdf6e7;border-left:3px solid #b45309;font-size:13px;line-height:1.6">${alertas.map(a => `<div style="margin-bottom:6px">${a}</div>`).join('')}</div>` : ''}
`);
}
