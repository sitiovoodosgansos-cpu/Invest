import React, { useState, useMemo } from 'react';
import {
  Receipt, Play, Send, AlertCircle, CheckCircle2, Clock, MailWarning,
  BellOff, Copy, Check, FileDown, MessageCircle, Mail,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatPercent, investidorEncerrado } from '../utils/helpers';
import { ORDEM_STATUS, ORDEM_TIPO, diaBrasilia, listarPendentes, saldoOrnabird } from '../utils/ordens';
import {
  pdfDaOrdem, pdfDoDia, textoDaOrdem, linkWhatsapp, linkEmail,
} from '../utils/ordemEntrega';

// A tela da manha: quem eu pago hoje, e quanto.
//
// A ordem das coisas na pagina segue a ordem das coisas no dia. Primeiro o
// total (a unica coisa que o dono precisa saber antes do cafe), depois a fila
// do que pagar, depois o que ja foi pago, e por ultimo os problemas.
//
// O FLUXO E "PAGA, DEPOIS AVISA"
// -----------------------------
// Foi decisao do dono: o investidor so recebe o comprovante depois que o
// dinheiro saiu. Por isso nao existe botao "enviar" separado do "marcar como
// paga" — os dois sao a mesma acao, e o texto do botao diz isso. Um botao de
// enviar sozinho criaria o estado "avisei antes de pagar", que e exatamente o
// que a decisao queria evitar.

function dataBr(iso) {
  const dia = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return '—';
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

function horaBr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function Aviso({ tom = 'alerta', children }) {
  const cores = {
    alerta: { fundo: '#fffbeb', borda: '#f59e0b', texto: '#92400e' },
    erro: { fundo: '#fef2f2', borda: '#ef4444', texto: '#991b1b' },
    ok: { fundo: '#f0fdf4', borda: '#10b981', texto: '#065f46' },
  }[tom];
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      background: cores.fundo, borderLeft: `3px solid ${cores.borda}`,
      color: cores.texto, padding: '10px 14px', borderRadius: 6,
      fontSize: 13, lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

// Uma chave PIX so serve se der pra colar no banco sem erro de digitacao.
function ChavePix({ chave }) {
  const [copiada, setCopiada] = useState(false);
  if (!chave) return null;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(chave);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 1600);
    } catch {
      // Navegador sem permissao de area de transferencia: a chave continua
      // visivel na tela pra ser copiada a mao.
    }
  };
  return (
    <button
      type="button"
      onClick={copiar}
      title="Copiar chave PIX"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        font: 'inherit', fontSize: 12, color: copiada ? '#047857' : '#6b7280',
      }}
    >
      {copiada ? <Check size={12} /> : <Copy size={12} />}
      {copiada ? 'copiada' : chave}
    </button>
  );
}

// Entrega manual da ordem: PDF, WhatsApp, e-mail e copiar.
//
// Existe porque o envio automatico depende do Resend, e servico de terceiro
// cai. Quando cair, o dinheiro ja saiu e o investidor esta sem o comprovante —
// entao precisa haver um caminho que nao passe por servidor nenhum. Estes
// quatro rodam inteiros no navegador.
//
// O e-mail aqui sai da CONTA DO DONO (mailto:), nao do Resend. E o que faz
// disto uma alternativa de verdade, e nao outro caminho pro mesmo ponto de
// falha.
function AcoesEntrega({ ordem, compacto = false }) {
  const [copiado, setCopiado] = useState(false);
  const zap = linkWhatsapp(ordem);
  const email = linkEmail(ordem);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(textoDaOrdem(ordem));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1600);
    } catch {
      // Navegador sem permissao de area de transferencia: restam os outros tres.
    }
  };

  const estilo = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: compacto ? '4px 8px' : '6px 10px',
    fontSize: 12, borderRadius: 8, cursor: 'pointer',
    border: '1px solid var(--border)', background: '#fff',
    color: 'var(--text-secondary)', textDecoration: 'none',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <button type="button" style={estilo} onClick={() => pdfDaOrdem(ordem)} title="Baixar a ordem em PDF">
        <FileDown size={13} /> PDF
      </button>

      {zap ? (
        <a style={estilo} href={zap} target="_blank" rel="noreferrer"
           title="Abrir o WhatsApp com a mensagem pronta">
          <MessageCircle size={13} /> WhatsApp
        </a>
      ) : (
        <span style={{ ...estilo, cursor: 'default', opacity: 0.5 }}
              title="Sem telefone valido no cadastro deste investidor">
          <MessageCircle size={13} /> sem telefone
        </span>
      )}

      {email ? (
        <a style={estilo} href={email.href}
           title={email.resumido
             ? 'Abrir seu e-mail com um resumo pronto — anexe o PDF, a ordem e longa demais pro corpo'
             : 'Abrir seu e-mail com a mensagem pronta'}>
          <Mail size={13} /> E-mail{email.resumido ? ' (resumo)' : ''}
        </a>
      ) : (
        <span style={{ ...estilo, cursor: 'default', opacity: 0.5 }}
              title="Sem e-mail no cadastro deste investidor">
          <Mail size={13} /> sem e-mail
        </span>
      )}

      <button type="button" style={estilo} onClick={copiar} title="Copiar o texto da ordem">
        {copiado ? <Check size={13} /> : <Copy size={13} />} {copiado ? 'copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function LinhaItem({ item }) {
  return (
    <tr>
      <td style={{ fontSize: 13, padding: '6px 0' }}>
        <div>{item.description}</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          {dataBr(item.date)}
          {item.quantity ? ` · ${item.quantity} un` : ''}
          {item.birdName ? ` · ${item.birdName}` : ''}
          {item.customer ? ` · ${item.customer}` : ''}
          {/* Vinculo por titulo do lote quebra em silencio se alguem renomear
              o card no Ornabird. Marcado aqui pra a conferencia dar uma
              olhada extra nessa linha. */}
          {item.matchedBy === 'title' ? ' · vinculo por titulo' : ''}
        </div>
      </td>
      <td style={{ fontSize: 12, color: '#6b7280', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {formatPercent(item.rate)} de {formatCurrency(item.amount)}
      </td>
      <td style={{
        fontSize: 13, fontWeight: 600, textAlign: 'right',
        whiteSpace: 'nowrap', paddingLeft: 12,
      }}>
        {formatCurrency(item.profit)}
      </td>
    </tr>
  );
}

function CartaoOrdem({ ordem, selecionada, onToggle, selecionavel }) {
  const [aberta, setAberta] = useState(false);
  const ehAviso = ordem.kind === ORDEM_TIPO.ZERO;
  const paga = ordem.status === ORDEM_STATUS.PAGA;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px 10px',
      }}>
        {selecionavel ? (
          <input
            type="checkbox"
            checked={selecionada}
            onChange={() => onToggle(ordem.id)}
            aria-label={`Selecionar a ordem de ${ordem.investorName}`}
            style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }}
          />
        ) : (
          <div style={{ width: 18, flexShrink: 0 }} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{ordem.investorName}</div>
          <div style={{
            fontSize: 12, color: '#6b7280', display: 'flex',
            gap: 8, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <span>Ordem {ordem.numero}</span>
            {ehAviso
              ? <span>· sem vendas em {dataBr(ordem.referenceDate)}</span>
              : <span>· {ordem.items.length} venda(s) · bruto {formatCurrency(ordem.totalAmount)}</span>}
            {ordem.investorPix && <>· <ChavePix chave={ordem.investorPix} /></>}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {ehAviso ? (
            <span className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <BellOff size={12} /> aviso
            </span>
          ) : (
            <div style={{ fontSize: 18, fontWeight: 700 }}>{formatCurrency(ordem.totalProfit)}</div>
          )}
          <div style={{ marginTop: 4, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {paga && (
              <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={11} /> paga {horaBr(ordem.paidAt)}
              </span>
            )}
            {ordem.sentAt && (
              <span className="badge badge-blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Send size={11} /> enviada
              </span>
            )}
            {ordem.sentError && (
              <span className="badge badge-orange" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <MailWarning size={11} /> nao enviada
              </span>
            )}
          </div>
        </div>

        {!ehAviso && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setAberta(v => !v)}
            style={{ flexShrink: 0 }}
          >
            {aberta ? 'Fechar' : 'Ver itens'}
          </button>
        )}
      </div>

      {/* Sempre visivel, e nao escondida atras de "Ver itens": o dia em que
          isto for necessario e um dia em que o envio automatico falhou, e ai
          nao da pra o caminho manual estar a um clique de descoberta. */}
      <div style={{
        padding: '0 16px 12px 46px',
        borderBottom: aberta ? '1px solid #e5e7eb' : 'none',
      }}>
        <AcoesEntrega ordem={ordem} compacto />
      </div>

      {aberta && (
        <div style={{ padding: '12px 16px 16px 46px', background: '#fafafa' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {ordem.items.map(item => <LinhaItem key={item.saleId} item={item} />)}
              <tr>
                <td colSpan={2} style={{ paddingTop: 10, fontWeight: 600, fontSize: 13 }}>
                  Total a pagar
                </td>
                <td style={{
                  paddingTop: 10, textAlign: 'right', fontWeight: 700, fontSize: 15,
                }}>
                  {formatCurrency(ordem.totalProfit)}
                </td>
              </tr>
            </tbody>
          </table>
          {ordem.sentError && (
            <div style={{ marginTop: 10 }}>
              <Aviso tom="erro">
                <MailWarning size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>O e-mail nao saiu: {ordem.sentError}. A ordem continua marcada
                  como paga — selecione de novo para tentar o envio outra vez, ou
                  use WhatsApp, e-mail ou PDF aqui em cima para entregar na mao.</span>
              </Aviso>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A FILA DE PENDENTES.
//
// Existe por causa do primeiro uso. A regra do sistema e "paga tudo que ainda
// nao foi pago" — certa a partir do dia em que ele assume os pagamentos, mas
// na estreia ela significa o historico INTEIRO do criatorio: centenas de vendas
// que o dono ja quitou a mao ao longo dos meses. Emitir aquilo de uma vez seria
// pagar tudo de novo.
//
// Entao antes de emitir qualquer coisa o dono olha a fila e decide: estas aqui
// viram ordem, aquelas ali ja estavam acertadas. Depois disso a fila so tem
// venda nova e a rotina automatica passa a ser segura.
function FilaPendentes({ pendentes, semDono, encerrados, onGerar, onAcertar, ocupado }) {
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [ate, setAte] = useState('');
  // Varios investidores de uma vez, nao um so: o pedido foi poder gerar "qual
  // ou quais". Conjunto vazio = todos, que e o estado util na maioria dos dias.
  const [filtroInvestidores, setFiltroInvestidores] = useState(() => new Set());
  const [expandidos, setExpandidos] = useState(() => new Set());
  // A data que vai ser carimbada na ordem. Comeca em hoje — o caso comum — mas
  // existe pra quando o dinheiro saiu num dia e o lancamento so foi feito no
  // outro: a ordem tem que dizer o dia do dinheiro.
  const [dataOrdem, setDataOrdem] = useState(() => diaBrasilia());

  const noFiltro = (investorId) => filtroInvestidores.size === 0 || filtroInvestidores.has(investorId);

  const visiveis = useMemo(
    () => pendentes.filter(p => noFiltro(p.investorId)),
    [pendentes, filtroInvestidores]
  );

  // Todos os investidores da fila, com o resumo de cada um — a lista das
  // "caixinhas" de filtro e a dos grupos sao a mesma coisa vista duas vezes.
  const todosOsGrupos = useMemo(() => {
    const mapa = new Map();
    for (const p of pendentes) {
      if (!mapa.has(p.investorId)) {
        mapa.set(p.investorId, { id: p.investorId, nome: p.investorName, linhas: [] });
      }
      mapa.get(p.investorId).linhas.push(p);
    }
    return [...mapa.values()].map(g => ({
      ...g,
      total: g.linhas.reduce((s, l) => s + l.profit, 0),
      // As linhas ja vem da mais recente pra mais antiga, entao a primeira e a
      // ultima venda sao as pontas. Calculadas explicitamente pro rotulo do
      // periodo continuar lendo "de X a Y" mesmo se a ordenacao mudar de novo.
      maisRecente: g.linhas.reduce((m, l) => (!m || (l.date || '') > m ? (l.date || m) : m), ''),
      maisAntiga: g.linhas.reduce((m, l) => (!m || (l.date || '') < m ? (l.date || m) : m), ''),
    }))
      // Do investidor que vendeu mais recentemente pro que vendeu ha mais
      // tempo: mesma logica das linhas, pelo mesmo motivo.
      .sort((a, b) => (b.maisRecente || '').localeCompare(a.maisRecente || ''));
  }, [pendentes]);

  const investidores = useMemo(
    () => todosOsGrupos.filter(g => noFiltro(g.id)),
    [todosOsGrupos, filtroInvestidores]
  );

  const alternar = (saleId) => setSelecionadas(prev => {
    const p = new Set(prev);
    if (p.has(saleId)) p.delete(saleId); else p.add(saleId);
    return p;
  });

  const definir = (ids, ligar) => setSelecionadas(prev => {
    const p = new Set(prev);
    for (const id of ids) { if (ligar) p.add(id); else p.delete(id); }
    return p;
  });

  // O botao que torna a limpeza do historico praticavel: numa fila de mil e
  // poucas vendas, marcar uma a uma nao e opcao.
  const selecionarAteData = () => {
    if (!ate) return;
    definir(visiveis.filter(p => (p.date || '') <= ate).map(p => p.saleId), true);
  };

  const escolhidas = useMemo(
    () => pendentes.filter(p => selecionadas.has(p.saleId)),
    [pendentes, selecionadas]
  );
  const totalEscolhido = escolhidas.reduce((s, p) => s + p.profit, 0);

  const executar = async (acao, extra) => {
    const ids = [...selecionadas];
    if (ids.length === 0) return;
    await acao(ids, extra);
    setSelecionadas(new Set());
  };

  const alternarInvestidor = (id) => setFiltroInvestidores(prev => {
    const p = new Set(prev);
    if (p.has(id)) p.delete(id); else p.add(id);
    return p;
  });

  return (
    <div style={{ marginBottom: 28 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 className="card-title">Vendas pendentes</h3>
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          {pendentes.length} venda(s) ·{' '}
          {formatCurrency(pendentes.reduce((s, p) => s + p.profit, 0))} a pagar
        </span>
      </div>

      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12, lineHeight: 1.5 }}>
        Tudo que ainda não entrou em nenhuma ordem. Escolha o que vira ordem de
        pagamento agora — e marque como <strong>já acertado</strong> o que você pagou
        fora do sistema, para sair da fila sem gerar pagamento.
      </p>

      {/* Uma caixinha por investidor, e nao uma lista suspensa de escolha unica:
          o pedido foi poder gerar as ordens de "qual ou quais" investidores. */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 10,
      }}>
        <span style={{ fontSize: 12, color: '#6b7280', marginRight: 2 }}>Investidores:</span>
        <button
          type="button"
          className={`btn btn-sm ${filtroInvestidores.size === 0 ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFiltroInvestidores(new Set())}
        >
          Todos ({todosOsGrupos.length})
        </button>
        {todosOsGrupos.map(g => (
          <button
            key={g.id}
            type="button"
            className={`btn btn-sm ${filtroInvestidores.has(g.id) ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => alternarInvestidor(g.id)}
            title={`${g.linhas.length} venda(s) · ${formatCurrency(g.total)}`}
          >
            {g.nome} ({g.linhas.length})
          </button>
        ))}
      </div>

      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>até</span>
          <input
            type="date"
            className="form-input"
            style={{ width: 'auto' }}
            value={ate}
            onChange={e => setAte(e.target.value)}
            aria-label="Selecionar vendas ate esta data"
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={selecionarAteData} disabled={!ate}>
            Selecionar até essa data
          </button>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => definir(visiveis.map(p => p.saleId), true)}
        >
          Selecionar todas ({visiveis.length})
        </button>
        {selecionadas.size > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelecionadas(new Set())}>
            Limpar seleção
          </button>
        )}
      </div>

      {semDono.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Aviso>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong>{semDono.length} venda(s) sem investidor</strong> não aparecem nesta
              fila porque o lote não está vinculado no Plantel — some{' '}
              {formatCurrency(semDono.reduce((s, v) => s + (v.amount || 0), 0))} em valor bruto.
              Faça o vínculo no Plantel e sincronize para elas entrarem.
            </span>
          </Aviso>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {investidores.map(grupo => {
          const ids = grupo.linhas.map(l => l.saleId);
          const todas = ids.every(id => selecionadas.has(id));
          const aberto = expandidos.has(grupo.id);
          // Com mais de mil linhas na estreia, abrir tudo de uma vez trava a
          // pagina. O grupo mostra o resumo; o detalhe e sob demanda.
          const amostra = aberto ? grupo.linhas : grupo.linhas.slice(0, 5);
          return (
            <div key={grupo.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                <input
                  type="checkbox"
                  checked={todas}
                  onChange={() => definir(ids, !todas)}
                  aria-label={`Selecionar as vendas de ${grupo.nome}`}
                  style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {grupo.nome}
                    {/* Quem saiu mas ainda tem dinheiro na fila. E o acerto final
                        que ninguem lembra de fazer — entao a fila lembra. */}
                    {encerrados.has(grupo.id) && (
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 999,
                        background: '#fef3c7', color: '#92400e',
                      }}>
                        participação encerrada
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {grupo.linhas.length} venda(s) ·{' '}
                    {dataBr(grupo.maisAntiga)} a {dataBr(grupo.maisRecente)}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                  {formatCurrency(grupo.total)}
                </div>
                {grupo.linhas.length > 5 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flexShrink: 0 }}
                    onClick={() => setExpandidos(prev => {
                      const p = new Set(prev);
                      if (p.has(grupo.id)) p.delete(grupo.id); else p.add(grupo.id);
                      return p;
                    })}
                  >
                    {aberto ? 'Fechar' : `Ver as ${grupo.linhas.length}`}
                  </button>
                )}
              </div>

              <div style={{ padding: '0 16px 12px 46px', background: '#fafafa' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {amostra.map(linha => (
                      <tr key={linha.saleId}>
                        <td style={{ width: 26, padding: '5px 0' }}>
                          <input
                            type="checkbox"
                            checked={selecionadas.has(linha.saleId)}
                            onChange={() => alternar(linha.saleId)}
                            aria-label={`Selecionar ${linha.description}`}
                            style={{ width: 15, height: 15, cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ fontSize: 12, padding: '5px 0', whiteSpace: 'nowrap', color: '#6b7280' }}>
                          {dataBr(linha.date)}
                        </td>
                        <td style={{ fontSize: 13, padding: '5px 8px' }}>{linha.description}</td>
                        <td style={{ fontSize: 12, color: '#6b7280', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {formatPercent(linha.rate)} de {formatCurrency(linha.amount)}
                        </td>
                        <td style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', paddingLeft: 12, whiteSpace: 'nowrap' }}>
                          {formatCurrency(linha.profit)}
                        </td>
                      </tr>
                    ))}
                    {!aberto && grupo.linhas.length > 5 && (
                      <tr>
                        <td colSpan={5} style={{ fontSize: 12, color: '#6b7280', paddingTop: 6 }}>
                          e mais {grupo.linhas.length - 5}…
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {selecionadas.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, marginTop: 16,
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '14px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          boxShadow: '0 -4px 12px rgba(0,0,0,.06)',
        }}>
          <div style={{ fontSize: 13 }}>
            <strong>{selecionadas.size}</strong> venda(s) selecionada(s) ·{' '}
            {formatCurrency(totalEscolhido)} a pagar
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {[...new Set(escolhidas.map(p => p.investorName))].join(', ') || '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
              Data da ordem
              <input
                type="date"
                className="form-input"
                style={{ width: 'auto' }}
                value={dataOrdem}
                onChange={e => setDataOrdem(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={ocupado}
              onClick={() => {
                if (!window.confirm(
                  `Marcar ${selecionadas.size} venda(s) como já acertadas fora do sistema?\n\n`
                  + 'Elas saem da fila e NÃO viram pagamento. Use para o histórico que '
                  + 'você já pagou à mão.'
                )) return;
                executar(onAcertar);
              }}
            >
              <CheckCircle2 size={16} /> Já acertadas
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={ocupado || !dataOrdem}
              onClick={() => executar(onGerar, dataOrdem)}
            >
              <Receipt size={16} />
              {ocupado ? 'Processando…' : 'Gerar ordens das selecionadas'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// O SALDO, VISTO DO LADO DAS ORDENS.
//
// Sem isto, "paguei" e um evento que nao deixa marca: a ordem sai da fila do
// dia e pronto. O dono nao tem onde olhar pra saber quanto ainda deve a cada
// um — e "quanto eu ainda devo" e a pergunta que ele faz todo dia.
//
// As quatro colunas somam o credito inteiro, e a soma e a prova de que nao ha
// dinheiro escondido: tudo que foi vendido esta em exatamente uma delas.
function SaldoPorInvestidor({ saldos }) {
  const comAlgo = saldos.filter(s => s.credito > 0);
  if (comAlgo.length === 0) return null;

  const totalAPagar = comAlgo.reduce((s, x) => s + x.aPagar, 0);
  const totalPago = comAlgo.reduce((s, x) => s + x.pago, 0);

  return (
    <div style={{ marginBottom: 28 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 className="card-title">Saldo das vendas do Ornabird</h3>
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          {formatCurrency(totalAPagar)} em aberto · {formatCurrency(totalPago)} já pago
        </span>
      </div>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 10, lineHeight: 1.5 }}>
        Cada ordem paga sai do <strong>em aberto</strong> e entra no <strong>pago</strong> —
        é assim que o pagamento abate o saldo. As quatro colunas somam o lucro
        inteiro das vendas do investidor, então nada fica fora da conta.
      </p>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, color: '#6b7280' }}>Investidor</th>
              <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12, color: '#6b7280' }}>Na fila</th>
              <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12, color: '#6b7280' }}>Ordem emitida</th>
              <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12, color: '#6b7280' }}>Pago</th>
              <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12, color: '#6b7280' }}>Acertado fora</th>
              <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: 12, color: '#6b7280' }}>A pagar</th>
            </tr>
          </thead>
          <tbody>
            {comAlgo.map(s => (
              <tr key={s.investorId} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={{ padding: '10px 14px', fontSize: 13 }}>
                  {s.nome}
                  {s.encerrado && (
                    <span style={{ fontSize: 11, color: '#92400e', marginLeft: 6 }}>· encerrado</span>
                  )}
                </td>
                <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right', color: '#6b7280' }}>{formatCurrency(s.pendente)}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right', color: '#6b7280' }}>{formatCurrency(s.emAberto)}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right', color: 'var(--success, #059669)' }}>{formatCurrency(s.pago)}</td>
                <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right', color: '#6b7280' }}>{formatCurrency(s.acertado)}</td>
                <td style={{ padding: '10px 14px', fontSize: 14, textAlign: 'right', fontWeight: 700 }}>{formatCurrency(s.aPagar)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OrdensPagamento() {
  const {
    paymentOrders, rotinaDiaria, rodarRotinaAgora, pagarEEnviarOrdens,
    ornabirdVitrine, birds, investors, eggProfitRate, birdProfitRate,
    gerarOrdensDasVendas, acertarVendas, liberarRotinaAutomatica,
  } = useApp();
  const { isAdmin } = useAuth();
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [rodando, setRodando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [processando, setProcessando] = useState(false);
  const [dia, setDia] = useState(() => diaBrasilia());

  const ordens = Array.isArray(paymentOrders) ? paymentOrders : [];

  // A fila de pendentes, calculada aqui no navegador com a MESMA funcao que o
  // servidor usa pra emitir. Se a tela calculasse de outro jeito, o numero
  // conferido e o numero pago seriam dois numeros diferentes.
  const { pendentes, semDono: pendentesSemDono } = useMemo(
    () => listarPendentes({
      vendas: Array.isArray(ornabirdVitrine) ? ornabirdVitrine : [],
      birds,
      investors,
      rates: { eggProfitRate, birdProfitRate },
      ordensExistentes: ordens,
    }),
    [ornabirdVitrine, birds, investors, eggProfitRate, birdProfitRate, ordens]
  );

  const encerrados = useMemo(
    () => new Set((investors || []).filter(investidorEncerrado).map(i => i.id)),
    [investors]
  );

  // O saldo de cada investidor no lado Ornabird: quanto ele ja recebeu e quanto
  // ainda falta. E a mesma conta que a tela de Aportes usa — vive em ordens.js
  // justamente pra as duas telas nunca darem numeros diferentes.
  const saldos = useMemo(
    () => saldoOrnabird({
      vendas: Array.isArray(ornabirdVitrine) ? ornabirdVitrine : [],
      birds,
      investors,
      rates: { eggProfitRate, birdProfitRate },
      ordens,
    }).map(s => ({
      ...s,
      nome: (investors || []).find(i => i.id === s.investorId)?.name || '(investidor removido)',
      encerrado: encerrados.has(s.investorId),
    })).sort((a, b) => b.aPagar - a.aPagar || a.nome.localeCompare(b.nome)),
    [ornabirdVitrine, birds, investors, eggProfitRate, birdProfitRate, ordens, encerrados]
  );

  // A emissao automatica das 6h so e liberada depois que o dono revisa a fila.
  // Enquanto houver acerto ou ordem emitida, consideramos revisado.
  const jaLiberado = rotinaDiaria?.resumo?.aguardandoLiberacao === false
    || ordens.some(o => o.kind === ORDEM_TIPO.ACERTADA || o.origem === 'manual')
    || (rotinaDiaria?.ok && !rotinaDiaria?.resumo?.aguardandoLiberacao);

  // Dias que tem ordem, do mais novo pro mais antigo. Serve de navegacao: o
  // dono quase sempre quer hoje, mas precisa poder voltar num dia que deixou
  // passar.
  const dias = useMemo(() => {
    const set = new Set(ordens.map(o => o.referenceDate).filter(Boolean));
    return [...set].sort().reverse();
  }, [ordens]);

  const doDia = useMemo(
    () => ordens
      .filter(o => o.referenceDate === dia)
      .sort((a, b) => (b.totalProfit || 0) - (a.totalProfit || 0)),
    [ordens, dia]
  );

  // Tres filas, e a divisao e a propria instrucao de uso:
  //   a pagar   — tem dinheiro e ainda nao saiu.
  //   avisos    — nao tem dinheiro; so o "nenhuma venda hoje".
  //   resolvidas— ja pagas (com ou sem e-mail entregue).
  const { aPagar, avisos, resolvidas } = useMemo(() => {
    const aPagar = [], avisos = [], resolvidas = [];
    for (const o of doDia) {
      if (o.status === ORDEM_STATUS.CANCELADA) continue;
      // Acerto nao e ordem: e o registro de que um lote de vendas antigas ja
      // estava quitado. Misturado com as pagas do dia, viraria uma linha de
      // milhares de reais que ninguem pagou hoje.
      if (o.kind === ORDEM_TIPO.ACERTADA) continue;
      if (o.status === ORDEM_STATUS.PAGA) resolvidas.push(o);
      else if (o.kind === ORDEM_TIPO.ZERO) avisos.push(o);
      else aPagar.push(o);
    }
    return { aPagar, avisos, resolvidas };
  }, [doDia]);

  const totalAPagar = aPagar.reduce((s, o) => s + (o.totalProfit || 0), 0);
  const totalPago = resolvidas.reduce((s, o) => s + (o.totalProfit || 0), 0);
  const semDono = rotinaDiaria?.resumo?.semDono || [];

  const alternar = (id) => {
    setSelecionadas(prev => {
      const proximo = new Set(prev);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  };

  const selecionarTodas = (lista) => {
    const ids = lista.map(o => o.id);
    const todasJa = ids.every(id => selecionadas.has(id));
    setSelecionadas(prev => {
      const proximo = new Set(prev);
      for (const id of ids) {
        if (todasJa) proximo.delete(id);
        else proximo.add(id);
      }
      return proximo;
    });
  };

  const rodar = async () => {
    setRodando(true);
    setResultado(null);
    try {
      const r = await rodarRotinaAgora();
      setDia(r.referenceDate || diaBrasilia());
      setResultado({
        tom: 'ok',
        texto: r.ordens === 0
          ? 'Rodada concluida. Nenhuma venda nova desde a ultima.'
          : `Rodada concluida: ${r.ordens} ordem(ns), ${formatCurrency(r.aPagar)} a pagar.`,
      });
    } catch {
      setResultado(null); // a mensagem real ja esta no saveError, no topo da pagina
    } finally {
      setRodando(false);
    }
  };

  const pagarEEnviar = async () => {
    const ids = [...selecionadas];
    if (ids.length === 0) return;
    setEnviando(true);
    setResultado(null);
    try {
      const r = await pagarEEnviarOrdens(ids);
      const falhas = (r.resultados || []).filter(x => !x.ok);
      setSelecionadas(new Set());
      setResultado({
        tom: falhas.length ? 'alerta' : 'ok',
        texto: falhas.length
          ? `${ids.length - falhas.length} de ${ids.length} enviada(s). Sem e-mail ou com falha: ` +
            falhas.map(f => `${f.investorName} (${f.motivo})`).join(', ') +
            (r.emailConfigurado ? '' : ' — o Resend ainda nao esta configurado neste projeto.')
          : `${ids.length} ordem(ns) marcada(s) como paga(s) e enviada(s).`,
      });
    } catch {
      setResultado(null);
    } finally {
      setEnviando(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="page-header">
        <h2>Ordens de Pagamento</h2>
        <p>Somente o administrador ve esta tela.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-start', gap: 16, flexWrap: 'wrap',
      }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Receipt size={22} /> Ordens de Pagamento
          </h2>
          <p>
            Todo dia as 6h o sistema sincroniza com o Ornabird e monta uma ordem por
            investidor com o que ele tem a receber. Pague, marque como paga, e o
            comprovante vai pra ele.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* O PDF do dia sai do que ja esta na tela, sem passar pelo servidor:
              serve tanto pra levar a lista pro banco quanto pra ter o dia
              inteiro em maos se o e-mail das 6h nao tiver saido. */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => pdfDoDia(doDia, dia)}
            disabled={doDia.length === 0}
            title="Baixar todas as ordens do dia em PDF"
          >
            <FileDown size={15} /> Baixar o dia (PDF)
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={rodar} disabled={rodando}>
            <Play size={15} />
            {rodando ? 'Rodando…' : 'Rodar agora'}
          </button>
        </div>
      </div>

      {/* Como foi a ultima rodada. Sem isto, "hoje ninguem vendeu" e "a rotina
          nem rodou" tem exatamente a mesma cara: uma lista vazia. */}
      <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!rotinaDiaria && (
          <Aviso>
            <Clock size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>A rotina automatica ainda nao rodou nenhuma vez. Use "Rodar agora"
              para gerar as ordens de hoje sem esperar o horario.</span>
          </Aviso>
        )}
        {rotinaDiaria && !rotinaDiaria.ok && (
          <Aviso tom="erro">
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>A ultima rodada ({horaBr(rotinaDiaria.lastRunAt)}) <strong>falhou</strong>: {rotinaDiaria.error}.
              As ordens abaixo podem estar incompletas — nenhuma venda entrou depois disso.</span>
          </Aviso>
        )}
        {rotinaDiaria?.ok && (
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Ultima rodada {horaBr(rotinaDiaria.lastRunAt)}
            {rotinaDiaria.origem === 'manual' ? ' (manual)' : ' (automatica)'}
            {rotinaDiaria.resumo?.email && !rotinaDiaria.resumo.email.enviado
              && ` · resumo por e-mail nao saiu (${rotinaDiaria.resumo.email.motivo})`}
          </div>
        )}
        {resultado && (
          <Aviso tom={resultado.tom}>
            {resultado.tom === 'ok'
              ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              : <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
            <span>{resultado.texto}</span>
          </Aviso>
        )}
      </div>

      {/* A trava do primeiro uso, explicada onde ela age. Sem este aviso, a
          pessoa clicaria "Rodar agora", veria zero ordens e concluiria que o
          sistema esta quebrado — quando ele esta justamente evitando emitir
          uma ordem gigante de dinheiro que ja saiu. */}
      {!jaLiberado && pendentes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Aviso>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong>A emissão automática das 6h está parada.</strong> Há{' '}
              {pendentes.length} venda(s) na fila —{' '}
              {formatCurrency(pendentes.reduce((s, p) => s + p.profit, 0))} — e boa parte
              disso pode ser histórico que você já pagou à mão. Revise a fila abaixo:
              gere ordens do que falta pagar e marque o resto como já acertado. Depois
              disso a rotina passa a emitir sozinha.
            </span>
          </Aviso>
        </div>
      )}

      {!jaLiberado && pendentes.length === 0 && ordens.length === 0 && (
        <div style={{ marginBottom: 16 }}>
          <Aviso tom="ok">
            <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Fila vazia. Assim que houver venda nova no Ornabird ela aparece aqui.{' '}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 6 }}
                disabled={processando}
                onClick={async () => {
                  setProcessando(true);
                  try {
                    await liberarRotinaAutomatica();
                    setResultado({ tom: 'ok', texto: 'Rotina automática liberada. A partir de agora ela emite sozinha às 6h.' });
                  } catch { /* saveError ja mostra */ } finally { setProcessando(false); }
                }}
              >
                Liberar a rotina automática
              </button>
            </span>
          </Aviso>
        </div>
      )}

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-label">A pagar em {dataBr(dia)}</div>
          <div className="stat-value">{formatCurrency(totalAPagar)}</div>
          <div className="stat-change">{aPagar.length} ordem(ns) na fila</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ja pago neste dia</div>
          <div className="stat-value">{formatCurrency(totalPago)}</div>
          <div className="stat-change">{resolvidas.length} ordem(ns)</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avisos de zero vendas</div>
          <div className="stat-value">{avisos.length}</div>
          <div className="stat-change">investidor(es) sem venda no dia</div>
        </div>
      </div>

      {dias.length > 1 && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Dia:</span>
          {dias.slice(0, 14).map(d => (
            <button
              key={d}
              type="button"
              className={`btn btn-sm ${d === dia ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setDia(d); setSelecionadas(new Set()); }}
            >
              {dataBr(d)}
            </button>
          ))}
        </div>
      )}

      {semDono.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Aviso>
            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong>{semDono.length} venda(s) nao entraram em ordem nenhuma</strong> porque o
              lote nao esta vinculado a nenhuma linha do Plantel. Ninguem vai receber por elas
              enquanto isso. Some {formatCurrency(semDono.reduce((s, v) => s + (v.amount || 0), 0))}:{' '}
              {semDono.slice(0, 4).map(v => `${v.description} (${dataBr(v.date)})`).join('; ')}
              {semDono.length > 4 ? ` e mais ${semDono.length - 4}.` : '.'}
            </span>
          </Aviso>
        </div>
      )}

      {pendentes.length > 0 && (
        <FilaPendentes
          pendentes={pendentes}
          semDono={pendentesSemDono}
          encerrados={encerrados}
          ocupado={processando}
          onGerar={async (saleIds, referenceDate) => {
            setProcessando(true);
            setResultado(null);
            try {
              const r = await gerarOrdensDasVendas(saleIds, referenceDate);
              setDia(r.referenceDate || diaBrasilia());
              setResultado({
                tom: 'ok',
                texto: `${r.ordens} ordem(ns) emitida(s) com ${r.vendas} venda(s) — ${formatCurrency(r.aPagar)} a pagar.`,
              });
            } catch { /* saveError ja mostra a mensagem */ } finally { setProcessando(false); }
          }}
          onAcertar={async (saleIds) => {
            setProcessando(true);
            setResultado(null);
            try {
              const r = await acertarVendas(saleIds);
              setResultado({
                tom: 'ok',
                texto: `${r.acertadas} venda(s) marcada(s) como já acertadas. Saíram da fila e não viraram pagamento.`,
              });
            } catch { /* saveError ja mostra a mensagem */ } finally { setProcessando(false); }
          }}
        />
      )}

      <SaldoPorInvestidor saldos={saldos} />

      {/* --- A fila --- */}
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="card-title">A pagar</h3>
        {aPagar.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => selecionarTodas(aPagar)}>
            {aPagar.every(o => selecionadas.has(o.id)) ? 'Desmarcar todas' : 'Selecionar todas'}
          </button>
        )}
      </div>

      {aPagar.length === 0 ? (
        <div className="card" style={{ color: '#6b7280', fontSize: 14 }}>
          Nada a pagar em {dataBr(dia)}.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {aPagar.map(o => (
            <CartaoOrdem
              key={o.id}
              ordem={o}
              selecionada={selecionadas.has(o.id)}
              onToggle={alternar}
              selecionavel
            />
          ))}
        </div>
      )}

      {avisos.length > 0 && (
        <>
          <div className="card-header" style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title">Sem vendas hoje</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => selecionarTodas(avisos)}>
              {avisos.every(o => selecionadas.has(o.id)) ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            Nao ha pagamento aqui — so o aviso de que nao houve venda, com o convite
            para aumentar o plantel. Podem ser enviados direto.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {avisos.map(o => (
              <CartaoOrdem
                key={o.id}
                ordem={o}
                selecionada={selecionadas.has(o.id)}
                onToggle={alternar}
                selecionavel
              />
            ))}
          </div>
        </>
      )}

      {resolvidas.length > 0 && (
        <>
          <div className="card-header" style={{ marginTop: 24 }}>
            <h3 className="card-title">Ja pagas</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {resolvidas.map(o => (
              <CartaoOrdem
                key={o.id}
                ordem={o}
                selecionada={selecionadas.has(o.id)}
                onToggle={alternar}
                // Reenvio: uma ordem paga cujo e-mail falhou precisa poder ser
                // selecionada de novo. Marcar de novo nao cobra nada duas vezes
                // — o servidor so grava paidAt se ainda nao estiver paga.
                selecionavel={Boolean(o.sentError) || !o.sentAt}
              />
            ))}
          </div>
        </>
      )}

      {/* Barra de acao fixa. Fica no rodape porque a decisao ("mandar estas")
          vem depois de percorrer a lista, e com muitos investidores o botao no
          topo sairia da tela justo na hora de usar. */}
      {selecionadas.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, marginTop: 24,
          background: '#fff', borderTop: '1px solid #e5e7eb',
          padding: '14px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          boxShadow: '0 -4px 12px rgba(0,0,0,.05)',
        }}>
          <div style={{ fontSize: 13 }}>
            <strong>{selecionadas.size}</strong> selecionada(s) ·{' '}
            {formatCurrency(
              [...selecionadas]
                .map(id => doDia.find(o => o.id === id))
                .reduce((s, o) => s + (o?.totalProfit || 0), 0)
            )}
          </div>
          <button type="button" className="btn btn-primary" onClick={pagarEEnviar} disabled={enviando}>
            <Send size={16} />
            {enviando ? 'Enviando…' : 'Marcar como paga e enviar ao investidor'}
          </button>
        </div>
      )}
    </div>
  );
}
