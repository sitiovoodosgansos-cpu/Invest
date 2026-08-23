import React, { useState, useMemo } from 'react';
import { useApp, useColecoes } from '../context/AppContext';
import { mapOrnabirdIncubatorBatches } from '../utils/helpers';
import OrnabirdSync from '../components/OrnabirdSync';
import {
  Thermometer, Egg, Package, TrendingUp, AlertTriangle, Clock3,
  ChevronDown, ChevronRight, User,
} from 'lucide-react';

// Espelho somente-leitura das Chocadeiras do Ornabird.
//
// A tela imita a de lá de propósito — mesmos cards de máquina, mesma contagem
// regressiva por espécie, mesmos chips de destino dos ovos — porque as duas
// descrevem a MESMA chocadeira. Ver o mesmo lote com números diferentes em
// cada sistema faz duvidar de qual está certo, e a dúvida contamina o rateio.
//
// Duas diferenças deliberadas em relação ao Ornabird:
//   1. Não há registrar evento / finalizar / editar. Isto aqui é espelho; a
//      ação acontece no Ornabird, que é a fonte da verdade.
//   2. As linhas mostram o INVESTIDOR dono do lote — é o que o Invest
//      acrescenta: a mesma chocagem, vista por quem vai receber.

// Mesmos limiares e textos do Ornabird (countdownState / countdownLabel).
function diasAte(alvo) {
  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.ceil((alvo.getTime() - inicioHoje.getTime()) / 86400000);
}

function somaDias(dataStr, dias) {
  const [y, m, d] = String(dataStr).slice(0, 10).split('-').map(Number);
  const x = new Date(y || 1970, (m || 1) - 1, d || 1);
  x.setDate(x.getDate() + (dias || 0));
  return x;
}

function dataBr(v) {
  if (!v) return '-';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  if (!y || !m || !d) return '-';
  return `${d}/${m}/${y}`;
}

// Mesmo formato do Ornabird (formatPercent: duas casas).
function pct(v) {
  return `${(Number.isFinite(v) ? v : 0).toFixed(2)}%`;
}

// Mesmos rótulos do Ornabird (batchStatusLabel), sobre o status já traduzido
// para o formato antigo do Invest.
const STATUS_LOTE = {
  incubating: 'Ativo',
  hatched: 'Finalizado com eclosao',
  failed: 'Falhou',
  canceled: 'Cancelado',
};

const CONTAGEM = {
  counting: { fundo: '#ecfdf5', texto: '#047857', barra: '#10b981' },
  today: { fundo: '#fffbeb', texto: '#b45309', barra: '#f59e0b' },
  overdue: { fundo: '#fff1f2', texto: '#be123c', barra: '#f43f5e' },
};

// Chips de destino dos ovos — mesmas cores e emojis da tela do Ornabird.
const CHIP = {
  ovos: { fundo: '#f4f4f5', texto: '#27272a' },
  nasceram: { fundo: '#d1fae5', texto: '#065f46' },
  inferteis: { fundo: '#f1f5f9', texto: '#334155' },
  pararam: { fundo: '#fef3c7', texto: '#92400e' },
  bicaram: { fundo: '#ffe4e6', texto: '#9f1239' },
  restam: { fundo: '#e0f2fe', texto: '#075985' },
};

function ChipTotal({ cor, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: cor.fundo, color: cor.texto, borderRadius: 999,
      padding: '2px 8px', fontSize: 11, fontWeight: 600,
    }}>
      {children}
    </span>
  );
}

// A capacidade é o primeiro número da descrição da chocadeira — regra da
// tela do Ornabird (parseCapacityFromDescription).
function capacidade(descricao) {
  if (!descricao) return 0;
  const m = String(descricao).match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

// Ícone da chocadeira, redesenhado do Ornabird (IncubatorIcon): caixa com
// visor e o LED aceso quando há lote ativo.
function IconeChocadeira({ ativa }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="24" height="24" style={{ color: '#b45309' }} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="white" />
      <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="14" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <ellipse cx="12" cy="14" rx="1.3" ry="1.7" fill="currentColor" opacity="0.55" />
      <circle cx="18" cy="7" r="0.9" fill={ativa ? '#10b981' : '#d4d4d8'} />
    </svg>
  );
}

export default function Incubators() {
  // Esta tela usa estes espelhos — sem declarar, eles nao sao lidos.
  useColecoes('chocadeiras');
  const { birds, investors, ornabirdIncubatorBatches, saveError, somenteLeitura } = useApp();
  const [aba, setAba] = useState('ativos'); // ativos | inativos
  const [lotesAbertos, setLotesAbertos] = useState(() => new Set());
  const [maquinasExpandidas, setMaquinasExpandidas] = useState(() => new Set());

  const batches = useMemo(
    () => mapOrnabirdIncubatorBatches(ornabirdIncubatorBatches, birds),
    [ornabirdIncubatorBatches, birds]
  );

  const nomeInvestidor = (bird) => {
    if (!bird?.investorId) return null;
    return (investors || []).find(i => i.id === bird.investorId)?.name ?? null;
  };

  const semVinculo = batches.filter(b => !b.birdId).length;

  // ===== KPIs — mesmos quatro cards do Ornabird =====
  const kpis = useMemo(() => {
    const maquinasAtivas = new Set(
      batches.filter(b => b.incubatorStatus === 'ACTIVE' && b.incubatorId).map(b => b.incubatorId)
    ).size;
    const lotesAtivos = batches.filter(b => b.status === 'incubating').length;
    const finalizados = batches.length - lotesAtivos;
    const ovos = batches.reduce((s, b) => s + b.totalEggs, 0);
    const nascidos = batches.reduce((s, b) => s + b.totalHatched, 0);
    return {
      maquinasAtivas, lotesAtivos, finalizados,
      taxa: ovos > 0 ? (nascidos / ovos) * 100 : 0,
    };
  }, [batches]);

  // ===== Cards por máquina, com contagem regressiva por espécie =====
  // Mesma matemática do Ornabird (incubatorStats): grupos por lote + dia de
  // entrada, "restam" = ovos - (nascidos + inférteis + parados + mortos na
  // casca), e grupo totalmente resolvido sai do card.
  const maquinas = useMemo(() => {
    const porMaquina = new Map();
    for (const b of batches) {
      const id = b.incubatorId || 'sem-chocadeira';
      if (!porMaquina.has(id)) {
        porMaquina.set(id, {
          id,
          nome: b.incubatorName || 'Chocadeira',
          descricao: b.incubatorDescription,
          statusAtivo: b.incubatorStatus === 'ACTIVE',
          rows: [],
        });
      }
      porMaquina.get(id).rows.push(b);
    }

    return Array.from(porMaquina.values()).map(m => {
      const chocagens = new Set(m.rows.map(r => r.dateIn)).size;
      const ovos = m.rows.reduce((s, r) => s + r.totalEggs, 0);
      const nascidos = m.rows.reduce((s, r) => s + r.totalHatched, 0);
      const ativos = m.rows.filter(r => r.status === 'incubating').length;

      const grupos = new Map();
      for (const r of m.rows) {
        const chave = `${r.originGroupId || r.id}|${r.dateIn}`;
        const consumido = r.totalHatched + r.totalInfertil + r.embryoLossCount + r.pippedDiedCount;
        const atual = grupos.get(chave);
        if (atual) {
          atual.ovos += r.totalEggs;
          atual.consumido += consumido;
          continue;
        }
        grupos.set(chave, {
          chave,
          titulo: r.flockGroupTitle || r.speciesName || 'Lote',
          bird: r.bird,
          ovos: r.totalEggs,
          consumido,
          diasTotais: r.incubationDays || 21,
          dataEntrada: r.dateIn,
        });
      }

      const contagens = Array.from(grupos.values())
        .map(g => {
          const restam = Math.max(0, g.ovos - g.consumido);
          const eclosao = somaDias(g.dataEntrada, g.diasTotais);
          const dias = diasAte(eclosao);
          const estado = dias < 0 ? 'overdue' : dias === 0 ? 'today' : 'counting';
          const rotulo = estado === 'overdue' ? `Atrasado ${Math.abs(dias)}d`
            : estado === 'today' ? 'Eclosao hoje' : `${dias}d`;
          const progresso = dias <= 0 ? 100
            : g.diasTotais > 0 ? Math.min(100, Math.max(0, ((g.diasTotais - dias) / g.diasTotais) * 100)) : 0;
          return { ...g, restam, eclosao, dias, estado, rotulo, progresso };
        })
        .filter(g => g.restam > 0)
        .sort((a, b) => a.dias - b.dias || b.ovos - a.ovos);

      return {
        ...m,
        chocagens,
        nascidos,
        ativos,
        taxa: ovos > 0 ? (nascidos / ovos) * 100 : 0,
        contagens,
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [batches]);

  // ===== Registro de lotes — agrupado pelo código [LOT:N] =====
  // Mesma regra do Ornabird: um lote fica em Ativos enquanto tiver batch
  // ativo E ovo sem destino; classificado o último ovo, vira Inativo.
  const lotes = useMemo(() => {
    const grupos = new Map();
    for (const b of batches) {
      const chave = b.lotCode ? `code:${b.lotCode}` : `legacy:${b.incubatorId}:${b.dateIn}:${b.notes}`;
      const atual = grupos.get(chave);
      if (atual) {
        atual.rows.push(b);
        if (b.status === 'incubating') atual.ativo = true;
        continue;
      }
      grupos.set(chave, {
        chave,
        codigo: b.lotCode,
        dataEntrada: b.dateIn,
        chocadeira: b.incubatorName || 'Chocadeira',
        ativo: b.status === 'incubating',
        statusPrimeiro: b.status,
        rows: [b],
      });
    }

    return Array.from(grupos.values()).map(l => {
      const totais = l.rows.reduce((acc, r) => {
        acc.ovos += r.totalEggs;
        acc.nasceram += r.totalHatched;
        acc.inferteis += r.totalInfertil;
        acc.pararam += r.embryoLossCount;
        acc.bicaram += r.pippedDiedCount;
        return acc;
      }, { ovos: 0, nasceram: 0, inferteis: 0, pararam: 0, bicaram: 0 });
      const consumido = totais.nasceram + totais.inferteis + totais.pararam + totais.bicaram;
      const restam = Math.max(0, totais.ovos - consumido);
      const encerrado = !l.ativo || (totais.ovos > 0 && restam <= 0);

      // Detalhamento por lote do plantel (uma linha por espécie), como a
      // tabela expandida de lá.
      const porGrupo = new Map();
      for (const r of l.rows) {
        const chaveGrupo = r.originGroupId || r.id;
        const atual = porGrupo.get(chaveGrupo);
        if (atual) {
          atual.ovos += r.totalEggs;
          atual.nasceram += r.totalHatched;
          atual.inferteis += r.totalInfertil;
          atual.pararam += r.embryoLossCount;
          atual.bicaram += r.pippedDiedCount;
          continue;
        }
        porGrupo.set(chaveGrupo, {
          chave: chaveGrupo,
          titulo: r.flockGroupTitle || r.speciesName || 'Lote',
          bird: r.bird,
          ovos: r.totalEggs,
          nasceram: r.totalHatched,
          inferteis: r.totalInfertil,
          pararam: r.embryoLossCount,
          bicaram: r.pippedDiedCount,
        });
      }

      return {
        ...l,
        totais,
        restam,
        encerrado,
        eclosao: totais.ovos > 0 ? (totais.nasceram / totais.ovos) * 100 : 0,
        linhas: Array.from(porGrupo.values()),
        status: l.ativo && !encerrado ? 'incubating' : (l.ativo ? 'hatched' : l.statusPrimeiro),
      };
    }).sort((a, b) => (b.dataEntrada || '').localeCompare(a.dataEntrada || ''));
  }, [batches]);

  const lotesAtivos = lotes.filter(l => !l.encerrado);
  const lotesInativos = lotes.filter(l => l.encerrado);
  const lotesVisiveis = aba === 'ativos' ? lotesAtivos : lotesInativos;

  const alternarLote = (chave) => {
    setLotesAbertos(prev => {
      const novo = new Set(prev);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });
  };

  const alternarMaquina = (id) => {
    setMaquinasExpandidas(prev => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  };

  return (
    <div className="animate-in">
      {saveError && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
          marginBottom: 12, background: '#fee2e2', border: '1px solid #ef4444',
          borderRadius: 8, color: '#991b1b', fontSize: 13,
        }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>Erro ao salvar.</strong>
            <div style={{ marginTop: 2, fontWeight: 400 }}>{saveError}</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2>Chocadeiras</h2>
          <p>Chocagens espelhadas do Ornabird — somente leitura</p>
        </div>
        <OrnabirdSync />
      </div>

      {/* Chocagem de lote nao vinculado nao pertence a investidor nenhum:
          entra nos totais mas fica sem dono no rateio. Avisar, nao esconder. */}
      {/* AVISO DE ADMINISTRADOR — nao aparece no portal do investidor.
          E uma instrucao de cadastro ("abra o Plantel, edite o animal"), e o
          investidor nao tem Plantel pra abrir nem permissao pra editar. Alem
          disso o numero e do CRIATORIO inteiro, e o portal so deve falar das
          aves dele. */}
      {semVinculo > 0 && !somenteLeitura && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
          marginBottom: 16, background: '#fef3c7', border: '1px solid #f59e0b',
          borderRadius: 8, color: '#92400e', fontSize: 13,
        }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>{semVinculo} chocagem(ns) sem investidor.</strong>
            <div style={{ marginTop: 2 }}>
              O lote de origem no Ornabird ainda nao foi vinculado a nenhuma linha do
              Plantel. Abra o Plantel, edite o animal correspondente e escolha o lote
              em &quot;Vinculo com o Ornabird&quot;.
            </div>
          </div>
        </div>
      )}

      {/* KPIs — mesmos quatro do Ornabird */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fef3c7', color: '#d97706' }}><Thermometer size={20} /></div>
          <div className="stat-label">Ativas</div>
          <div className="stat-value">{kpis.maquinasAtivas}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fef9c3', color: '#a16207' }}><Egg size={20} /></div>
          <div className="stat-label">Lotes ativos</div>
          <div className="stat-value">{kpis.lotesAtivos}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#e0e7ff', color: '#4338ca' }}><Package size={20} /></div>
          <div className="stat-label">Finalizados</div>
          <div className="stat-value">{kpis.finalizados}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon green"><TrendingUp size={20} /></div>
          <div className="stat-label">Taxa eclosao</div>
          <div className="stat-value">{pct(kpis.taxa)}</div>
        </div>
      </div>

      {/* Painel de chocadeiras */}
      {maquinas.length > 0 && (
        <div className="tray-grid" style={{ marginBottom: 24 }}>
          {maquinas.map(m => {
            const expandida = maquinasExpandidas.has(m.id);
            const visiveis = expandida ? m.contagens : m.contagens.slice(0, 6);
            const ovosInseridos = m.contagens.reduce((s, g) => s + g.ovos, 0);
            const cap = capacidade(m.descricao);
            return (
              <div key={m.id} style={{
                border: '1px solid #fde68a', borderRadius: 16, background: '#fff',
                padding: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12, background: '#fef3c7',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <IconeChocadeira ativa={m.ativos > 0} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{m.nome}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {cap > 0 ? `Capacidade: ${cap} ovos` : 'Capacidade nao informada'}
                    </div>
                    <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 2 }}>
                      Status: {m.statusAtivo ? 'Ativa' : 'Inativa'}
                    </div>
                  </div>
                </div>

                <div style={{
                  marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
                  background: 'var(--bg-secondary)', borderRadius: 12, padding: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Chocagens</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{m.chocagens}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Nascidos</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{m.nascidos}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Taxa</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{pct(m.taxa)}</div>
                  </div>
                </div>

                {m.contagens.length > 0 && (
                  <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                        Contagem por especie ({m.contagens.length})
                      </span>
                      <ChipTotal cor={CHIP.ovos}>🥚 {ovosInseridos} ovos inseridos</ChipTotal>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {visiveis.map(g => {
                        const corES = CONTAGEM[g.estado];
                        const investidor = nomeInvestidor(g.bird);
                        return (
                          <div key={g.chave} style={{
                            border: '1px solid var(--border)', borderRadius: 12,
                            background: 'var(--bg-secondary)', padding: 10,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {g.titulo}
                                </div>
                                {investidor && (
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <User size={10} /> {investidor}
                                  </div>
                                )}
                              </div>
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
                                background: corES.fundo, color: corES.texto, borderRadius: 999,
                                padding: '3px 8px', fontSize: 12, fontWeight: 600,
                              }}>
                                <Clock3 size={13} /> {g.rotulo}
                              </span>
                            </div>
                            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                              <ChipTotal cor={CHIP.ovos}>{g.restam}/{g.ovos} ovos</ChipTotal>
                              <span>Eclosao: {g.eclosao.toLocaleDateString('pt-BR')}</span>
                            </div>
                            <div style={{ marginTop: 8, height: 8, borderRadius: 999, background: '#e4e4e7', overflow: 'hidden' }}>
                              <div style={{ width: `${g.progresso}%`, height: '100%', borderRadius: 999, background: corES.barra, transition: 'width .5s' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {m.contagens.length > 6 && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ marginTop: 10, width: '100%', borderStyle: 'dashed' }}
                        onClick={() => alternarMaquina(m.id)}
                      >
                        {expandida ? 'Mostrar menos' : `Mostrar mais ${m.contagens.length - 6} especies`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Registro de lotes */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="card-title">Registro de lotes</span>
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary)', borderRadius: 999, padding: 4 }}>
            <button
              type="button"
              onClick={() => setAba('ativos')}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: 999, padding: '4px 12px',
                fontSize: 12, fontWeight: 600,
                background: aba === 'ativos' ? '#fff' : 'transparent',
                color: aba === 'ativos' ? 'var(--text)' : 'var(--text-muted)',
                boxShadow: aba === 'ativos' ? '0 1px 2px rgba(0,0,0,.12)' : 'none',
              }}
            >
              Ativos ({lotesAtivos.length})
            </button>
            <button
              type="button"
              onClick={() => setAba('inativos')}
              style={{
                border: 'none', cursor: 'pointer', borderRadius: 999, padding: '4px 12px',
                fontSize: 12, fontWeight: 600,
                background: aba === 'inativos' ? '#fff' : 'transparent',
                color: aba === 'inativos' ? 'var(--text)' : 'var(--text-muted)',
                boxShadow: aba === 'inativos' ? '0 1px 2px rgba(0,0,0,.12)' : 'none',
              }}
            >
              Inativos ({lotesInativos.length})
            </button>
          </div>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lotesVisiveis.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Nenhum lote nesse filtro.</p>
          )}
          {lotesVisiveis.map((l, idx) => {
            const aberto = lotesAbertos.has(l.chave);
            return (
              <div key={l.chave} style={{ border: '1px solid var(--border)', borderRadius: 16, background: '#fff', padding: 12 }}>
                <button
                  type="button"
                  onClick={() => alternarLote(l.chave)}
                  aria-expanded={aberto}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'flex-start',
                    justifyContent: 'space-between', gap: 8, textAlign: 'left',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      Lote #{l.codigo ?? lotesVisiveis.length - idx}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {l.chocadeira} | Entrada: {dataBr(l.dataEntrada)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Status: {STATUS_LOTE[l.status] || l.status}
                    </div>
                  </div>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }}>
                    {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                </button>

                {/* Mini-relatorio do lote — mesmos chips do Ornabird */}
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <ChipTotal cor={CHIP.ovos}>🥚 Ovos {l.totais.ovos}</ChipTotal>
                  <ChipTotal cor={CHIP.nasceram}>🐣 Nasceram {l.totais.nasceram}</ChipTotal>
                  <ChipTotal cor={CHIP.inferteis}>🚫 Inferteis {l.totais.inferteis}</ChipTotal>
                  <ChipTotal cor={CHIP.pararam}>🛑 Pararam {l.totais.pararam}</ChipTotal>
                  <ChipTotal cor={CHIP.bicaram}>💀 Bicaram {l.totais.bicaram}</ChipTotal>
                  {l.restam > 0 && <ChipTotal cor={CHIP.restam}>⏳ Restam {l.restam}</ChipTotal>}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: '#059669', color: '#fff', borderRadius: 999,
                    padding: '2px 8px', fontSize: 11, fontWeight: 600,
                  }}>
                    📈 Eclosao {pct(l.eclosao)}
                  </span>
                </div>

                {!aberto && (
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                    Toque para ver o detalhamento por especie.
                  </p>
                )}

                {aberto && (
                  <div className="table-container" style={{ marginTop: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>
                          <th style={{ padding: '6px 8px', textAlign: 'left' }}>Especie</th>
                          <th style={{ padding: '6px 8px', textAlign: 'left' }}>Investidor</th>
                          <th style={{ padding: '6px 8px', textAlign: 'center' }}>Ovos</th>
                          <th style={{ padding: '6px 8px', textAlign: 'center' }}>Nascidos</th>
                          <th style={{ padding: '6px 8px', textAlign: 'center' }}>Inferteis</th>
                          <th style={{ padding: '6px 8px', textAlign: 'center' }}>Nao desenvolveu</th>
                          <th style={{ padding: '6px 8px', textAlign: 'center' }}>Morreu na casca</th>
                          <th style={{ padding: '6px 8px', textAlign: 'center' }}>Eclosao</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.linhas.map(linha => {
                          const investidor = nomeInvestidor(linha.bird);
                          const taxaLinha = linha.ovos > 0 ? (linha.nasceram / linha.ovos) * 100 : 0;
                          return (
                            <tr key={linha.chave} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: 8, fontSize: 13, fontWeight: 600 }}>
                                {linha.titulo}
                                {!linha.bird && (
                                  <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600 }}>
                                    sem vinculo no Plantel
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: 8, fontSize: 12, color: 'var(--text-secondary)' }}>{investidor || '-'}</td>
                              <td style={{ padding: 8, textAlign: 'center', fontWeight: 600 }}>{linha.ovos}</td>
                              <td style={{ padding: 8, textAlign: 'center', fontWeight: 600, color: 'var(--success)' }}>{linha.nasceram}</td>
                              <td style={{ padding: 8, textAlign: 'center' }}>{linha.inferteis}</td>
                              <td style={{ padding: 8, textAlign: 'center' }}>{linha.pararam}</td>
                              <td style={{ padding: 8, textAlign: 'center' }}>{linha.bicaram}</td>
                              <td style={{ padding: 8, textAlign: 'center' }}>
                                <span style={{
                                  background: '#d1fae5', color: '#065f46', borderRadius: 999,
                                  padding: '2px 8px', fontSize: 11, fontWeight: 600,
                                }}>
                                  {linha.ovos > 0 ? `${taxaLinha.toFixed(1)}%` : '—'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {batches.length === 0 && (
        <div className="empty-state">
          <Thermometer size={48} />
          <h3>Nenhuma chocagem espelhada</h3>
          <p>Registre os lotes na Chocadeira do Ornabird e clique em &quot;Sincronizar com o Ornabird&quot; para vê-los aqui</p>
        </div>
      )}
    </div>
  );
}
