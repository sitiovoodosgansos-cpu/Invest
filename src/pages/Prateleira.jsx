import React, { useState, useMemo } from 'react';
import { useApp, useColecoes } from '../context/AppContext';
import {
  getInitials, buildOrnabirdGroupIndex, resolveMirrorBird,
} from '../utils/helpers';
import { Layers, Search, Link2, AlertCircle, Egg, Hourglass, CalendarX } from 'lucide-react';
import OrnabirdSync from '../components/OrnabirdSync';

// Espelho somente-leitura da Prateleira do Ornabird, em cards.
//
// A tela imita a de lá de propósito — mesmo card, mesmas cores de urgência,
// mesmos textos de contagem regressiva — porque as duas descrevem a MESMA
// prateleira. Ver a mesma bandeja com aparência diferente em cada sistema faz
// duvidar de qual está certa, e essa dúvida contamina o rateio.
//
// Duas diferenças deliberadas em relação ao Ornabird:
//   1. Não há botões de vender / chocar / descartar. Isto aqui é espelho; a
//      ação acontece no Ornabird, que é a fonte da verdade.
//   2. Cada card mostra o INVESTIDOR. É o que o Invest acrescenta: a mesma
//      bandeja, vista pela ótica de quem vai receber.

// Dias restantes calculados NA EXIBIÇÃO, a partir da data absoluta que a API
// manda. Guardar "faltam N dias" no Firestore daria um número que azeda
// sozinho entre uma sincronização e outra.
function diasRestantes(expiresAt) {
  if (!expiresAt) return null;
  const inicioDoDia = (v) => {
    const x = new Date(v);
    if (Number.isNaN(x.getTime())) return null;
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const venc = inicioDoDia(expiresAt);
  const hoje = inicioDoDia(new Date());
  if (venc === null || hoje === null) return null;
  return Math.round((venc - hoje) / 86400000);
}

// Mesmos limiares do Ornabird (urgencyTone).
function tom(dias) {
  if (dias === null) return 'neutro';
  if (dias < 0) return 'vencido';
  if (dias <= 3) return 'alerta';
  return 'fresco';
}

const PALETA = {
  vencido: { borda: '#fecdd3', fundo: '#fff1f2', chip: '#ffe4e6', texto: '#be123c', barra: '#f43f5e' },
  alerta: { borda: '#fde68a', fundo: '#fffbeb', chip: '#fef3c7', texto: '#b45309', barra: '#f59e0b' },
  fresco: { borda: '#a7f3d0', fundo: '#f0fdf4', chip: '#d1fae5', texto: '#047857', barra: '#10b981' },
  neutro: { borda: '#e5e7eb', fundo: '#fff', chip: '#f3f4f6', texto: '#6b7280', barra: '#9ca3af' },
};

// Mesmo texto do Ornabird (countdownLabel).
function textoContagem(dias) {
  if (dias === null) return 'sem validade';
  if (dias < 0) return `Vencido ha ${Math.abs(dias)}d`;
  if (dias === 0) return 'Vence hoje';
  if (dias === 1) return '1 dia restante';
  return `${dias} dias restantes`;
}

function dataCurta(v) {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// Cabeçalho do card: título do lote quando existe, senão espécie · raça ·
// variedade. Mesma regra do trayHeader do Ornabird — bandeja externa não tem
// lote e cai no segundo caso.
function cabecalho(tray) {
  if (tray.flockGroupTitle) return tray.flockGroupTitle;
  const partes = [tray.speciesLabel, tray.breedLabel, tray.varietyLabel].filter(Boolean);
  return partes.join(' · ') || 'Bandeja';
}

// A bandeja vence junto com a entrada mais velha que ainda tem ovo — é ela que
// obriga a usar ou descartar. Mesma regra do Ornabird (oldestRemaining).
function vencimentoDaBandeja(entradasVivas) {
  const dias = entradasVivas.map((e) => e.dias).filter((d) => d !== null);
  return dias.length === 0 ? null : Math.min(...dias);
}

function LinhaEntrada({ entrada }) {
  const p = PALETA[tom(entrada.dias)];
  // A barra mostra a IDADE do ovo: quanto da validade já passou. Cheia e
  // vermelha = no fim do prazo. É a mesma leitura do Ornabird.
  const ini = new Date(entrada.entryDate).getTime();
  const fim = new Date(entrada.expiresAt).getTime();
  const total = Math.max(1, fim - ini);
  const idade = Math.min(100, Math.max(0, ((Date.now() - ini) / total) * 100));

  return (
    <div style={{ border: '1px solid #fff', background: 'rgba(255,255,255,0.8)', borderRadius: 8, padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#52525b' }}>{dataCurta(entrada.entryDate)}</span>
          {entrada.source === 'EXTERNAL' && (
            <span style={{
              background: '#ede9fe', color: '#6d28d9', borderRadius: 999,
              padding: '1px 6px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
            }}>
              ext
            </span>
          )}
          <span style={{
            background: p.chip, color: p.texto, borderRadius: 999,
            padding: '1px 6px', fontSize: 10, fontWeight: 600,
          }}>
            {textoContagem(entrada.dias)}
          </span>
        </div>
        <span style={{ fontSize: 10, color: '#71717a' }}>
          {entrada.available}/{entrada.initialCount}
        </span>
      </div>
      <div style={{ marginTop: 4, height: 4, borderRadius: 999, background: '#e4e4e7', overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 999, background: p.barra, width: `${idade}%` }} />
      </div>
    </div>
  );
}

function CardBandeja({ tray }) {
  // O aviso de "sem vinculo" e recado de cadastro pro dono, e este card
  // tambem e renderizado dentro do portal do investidor.
  const { somenteLeitura } = useApp();
  const [aberto, setAberto] = useState(false);
  const p = PALETA[tom(tray.dias)];
  const entradas = tray.entradasVivas;
  const visiveis = aberto ? entradas : entradas.slice(0, 3);

  return (
    <div style={{
      border: `1px solid ${p.borda}`, background: p.fundo, borderRadius: 16,
      padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12, background: p.chip,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Egg size={16} style={{ color: p.texto }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#18181b' }}>{cabecalho(tray)}</div>
            <div style={{ fontSize: 11, color: '#71717a' }}>
              {entradas.length} {entradas.length === 1 ? 'data' : 'datas'}
              {tray.expiryDays ? ` · ${tray.expiryDays}d` : ''}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a1a1aa' }}>
            Disponiveis
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#18181b' }}>{tray.eggCount}</div>
        </div>
      </div>

      {/* O que o Invest acrescenta ao card do Ornabird: de quem sao estes ovos. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {tray.investor ? (
          <>
            <div className="investor-avatar" style={{ width: 20, height: 20, fontSize: 9, borderRadius: 6 }}>
              {getInitials(tray.investor.name)}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{tray.investor.name}</span>
          </>
        ) : (
          // "Sem vinculo" e recado de cadastro pro dono. No portal, uma bandeja
          // sem dono resolvido nao vira acusacao: fica sem a linha do
          // investidor, e pronto.
          !somenteLeitura && (
            <span className="badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 10 }}>
              Sem vinculo — nao entra no rateio
            </span>
          )
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visiveis.map((e) => <LinhaEntrada key={e.id} entrada={e} />)}
        {entradas.length > 3 && (
          <button
            type="button"
            onClick={() => setAberto(!aberto)}
            style={{
              width: '100%', border: '1px dashed #d4d4d8', borderRadius: 8, padding: '4px 0',
              fontSize: 11, fontWeight: 600, color: '#71717a', background: 'transparent', cursor: 'pointer',
            }}
          >
            {aberto ? 'Recolher' : `+${entradas.length - 3} datas`}
          </button>
        )}
      </div>

      {tray.discardedCount > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {tray.discardedCount} descartado(s) nesta bandeja
        </div>
      )}
    </div>
  );
}

export default function Prateleira() {
  // Esta tela usa estes espelhos — sem declarar, eles nao sao lidos.
  useColecoes('bandejas');
  const { investors, birds, ornabirdTrays, somenteLeitura } = useApp();
  const [search, setSearch] = useState('');
  const [filterInvestor, setFilterInvestor] = useState('');

  const trays = Array.isArray(ornabirdTrays) ? ornabirdTrays : [];

  // Uma bandeja pertence a um investidor só quando o lote dela foi vinculado a
  // uma linha do Plantel. Bandeja sem vínculo aparece em vez de sumir: sumir
  // faria os ovos desaparecerem do rateio em silêncio.
  const groupIndex = useMemo(() => buildOrnabirdGroupIndex(birds), [birds]);
  const rows = useMemo(() => trays.map((t) => {
    const bird = resolveMirrorBird(t, groupIndex);
    const investor = bird ? investors.find((i) => i.id === bird.investorId) : null;
    const entradasVivas = (t.entries || [])
      .filter((e) => (e.available ?? 0) > 0)
      .map((e) => ({ ...e, dias: diasRestantes(e.expiresAt) }));
    return { ...t, bird, investor, entradasVivas, dias: vencimentoDaBandeja(entradasVivas) };
  }), [trays, groupIndex, investors]);

  const filtered = useMemo(() => rows.filter((r) => {
    const haystack = `${r.flockGroupTitle || ''} ${r.label || ''} ${r.breedLabel || ''} ${r.speciesLabel || ''} ${r.varietyLabel || ''}`.toLowerCase();
    const matchSearch = !search.trim() || haystack.includes(search.toLowerCase());
    const matchInvestor = !filterInvestor
      || (filterInvestor === '__none__' ? !r.investor : r.investor?.id === filterInvestor);
    return matchSearch && matchInvestor;
  }), [rows, search, filterInvestor]);

  // Os mesmos quatro números do Ornabird, com os mesmos limiares, para as duas
  // telas nunca discordarem.
  const totals = useMemo(() => filtered.reduce((acc, r) => {
    acc.eggs += parseInt(r.eggCount, 10) || 0;
    if (r.dias !== null && r.dias < 0) acc.vencidas += 1;
    else if (r.dias !== null && r.dias <= 3) acc.vencendo += 1;
    return acc;
  }, { eggs: 0, vencendo: 0, vencidas: 0 }), [filtered]);

  const unlinked = rows.filter((r) => !r.bird).length;

  if (trays.length === 0) {
    return (
      <div className="animate-in">
        <div className="page-header">
          <h2>Prateleira</h2>
          <p>Bandejas de ovos espelhadas do Ornabird</p>
        </div>
        <div className="empty-state">
          <Layers size={48} />
          <h3>Nenhuma bandeja sincronizada</h3>
          <p style={{ maxWidth: 460, margin: '0 auto' }}>
            Esta pagina espelha a prateleira do Ornabird. As bandejas aparecem aqui
            depois que a sincronizacao estiver ligada e os lotes do Plantel estiverem
            vinculados ao Ornabird.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <OrnabirdSync />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Prateleira</h2>
        <p>Bandejas de ovos espelhadas do Ornabird — somente leitura</p>
        <OrnabirdSync />
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon purple"><Layers size={20} /></div>
          <div className="stat-label">Bandejas</div>
          <div className="stat-value">{filtered.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fef3c7', color: '#d97706' }}><Egg size={20} /></div>
          <div className="stat-label">Ovos na Prateleira</div>
          <div className="stat-value">{totals.eggs}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fef3c7', color: '#b45309' }}><Hourglass size={20} /></div>
          <div className="stat-label">Vencendo em Breve</div>
          <div className="stat-value" style={{ color: totals.vencendo > 0 ? 'var(--warning)' : undefined }}>
            {totals.vencendo}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fee2e2', color: '#dc2626' }}><CalendarX size={20} /></div>
          <div className="stat-label">Bandejas Vencidas</div>
          <div className="stat-value" style={{ color: totals.vencidas > 0 ? 'var(--danger)' : undefined }}>
            {totals.vencidas}
          </div>
        </div>
        {/* O CONTADOR de linhas sem vinculo e diagnostico de cadastro: diz ao
            dono quantos lotes do Ornabird faltam ligar ao Plantel. No portal
            do investidor nao cabe — ele nao liga lote nenhum, e o numero seria
            do criatorio inteiro. */}
        {!somenteLeitura && (
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: unlinked > 0 ? '#fef3c7' : '#d1fae5', color: unlinked > 0 ? '#d97706' : '#059669' }}>
              <Link2 size={20} />
            </div>
            <div className="stat-label">Sem Vinculo</div>
            <div className="stat-value" style={{ color: unlinked > 0 ? 'var(--warning)' : 'var(--success)' }}>{unlinked}</div>
          </div>
        )}
      </div>

      {/* AVISO DE ADMINISTRADOR — nao aparece no portal do investidor.
          E uma instrucao de cadastro ("abra o Plantel, edite o animal"), e o
          investidor nao tem Plantel pra abrir nem permissao pra editar. Alem
          disso o numero e do CRIATORIO inteiro, e o portal so deve falar das
          aves dele. */}
      {unlinked > 0 && !somenteLeitura && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
          marginBottom: 16, background: '#fef3c7', border: '1px solid #f59e0b',
          borderRadius: 8, color: '#92400e', fontSize: 13,
        }}>
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>{unlinked} bandeja(s) sem investidor.</strong>
            <div style={{ marginTop: 2 }}>
              O lote de origem no Ornabird ainda nao foi vinculado a nenhuma linha do
              Plantel. Abra o Plantel, edite o animal correspondente e escolha o lote
              em &quot;Vinculo com o Ornabird&quot;.
            </div>
          </div>
        </div>
      )}

      <div className="filter-bar">
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            style={{ paddingLeft: 36 }}
            placeholder="Buscar bandeja, raca..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-input"
          style={{ width: 'auto', minWidth: 200 }}
          value={filterInvestor}
          onChange={(e) => setFilterInvestor(e.target.value)}
        >
          <option value="">Todos os investidores</option>
          {investors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          {/* Filtro de diagnostico: serve pro dono isolar o que falta vincular.
              Sem sentido pro investidor, que so tem as aves dele. */}
          {!somenteLeitura && <option value="__none__">— Sem vinculo —</option>}
        </select>
      </div>

      {/* Mais urgente primeiro: quem vence antes precisa de decisao antes. */}
      <div className="tray-grid">
        {[...filtered]
          .sort((a, b) => {
            if (a.dias === null) return 1;
            if (b.dias === null) return -1;
            return a.dias - b.dias;
          })
          .map((t) => <CardBandeja key={t.id} tray={t} />)}
      </div>

      <div style={{ padding: '12px 4px', fontSize: 12, color: 'var(--text-muted)' }}>
        Espelho da prateleira do Ornabird: so bandejas ativas, so entradas que ainda
        tem ovo — as mesmas regras da tela de la. A barra de cada data mostra quanto
        da validade ja passou. Para vender, chocar ou descartar, use o Ornabird; as
        alteracoes aparecem aqui na proxima sincronizacao.
      </div>
    </div>
  );
}
