import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatDate, getInitials, buildOrnabirdGroupIndex, resolveMirrorBird,
} from '../utils/helpers';
import { Layers, Search, Link2, AlertCircle, Egg, Hourglass, CalendarX } from 'lucide-react';
import OrnabirdSync from '../components/OrnabirdSync';

// Espelho somente-leitura da Prateleira do Ornabird.
//
// Esta tela imita a de lá de propósito — mesmos cartões, mesmos limiares de
// validade — porque as duas descrevem a MESMA prateleira, e números diferentes
// nos dois lugares corroem a confiança no rateio. O Ornabird segue como fonte
// da verdade: aqui nada é editado.
//
// O que esta tela acrescenta é a coluna Investidor: a mesma bandeja, vista pela
// ótica de quem vai receber.

// Dias restantes até vencer, contados na HORA DA EXIBIÇÃO.
//
// A API manda expiresAt (data absoluta) em vez de "faltam N dias" justamente
// por isto: o espelho fica guardado no Firestore até a próxima sincronização, e
// um contador congelado passaria a mentir a cada dia.
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

// A bandeja vence junto com a entrada mais velha que ainda tem ovo — é ela que
// obriga a usar ou descartar. Mesma regra do Ornabird (oldestRemaining).
function vencimentoDaBandeja(tray) {
  const vivos = (tray.entries || []).filter((e) => (e.available ?? 0) > 0);
  const dias = vivos.map((e) => diasRestantes(e.expiresAt)).filter((d) => d !== null);
  if (dias.length === 0) return null;
  return Math.min(...dias);
}

function EtiquetaValidade({ dias }) {
  if (dias === null) return <span style={{ color: 'var(--text-muted)' }}>-</span>;
  if (dias < 0) {
    return (
      <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>
        vencida ha {Math.abs(dias)}d
      </span>
    );
  }
  if (dias <= 3) {
    return (
      <span className="badge" style={{ background: '#fef3c7', color: '#b45309' }}>
        {dias === 0 ? 'vence hoje' : `${dias}d`}
      </span>
    );
  }
  return <span style={{ fontSize: 13 }}>{dias}d</span>;
}

export default function Prateleira() {
  const { investors, birds, ornabirdTrays } = useApp();
  const [search, setSearch] = useState('');
  const [filterInvestor, setFilterInvestor] = useState('');

  const trays = Array.isArray(ornabirdTrays) ? ornabirdTrays : [];

  // Uma bandeja pertence a um investidor só quando o lote dela foi vinculado a
  // uma linha do Plantel. Bandeja sem vínculo aparece em vez de sumir: sumir
  // faria os ovos desaparecerem do rateio em silêncio.
  const groupIndex = useMemo(() => buildOrnabirdGroupIndex(birds), [birds]);
  const rows = useMemo(() => trays.map(t => {
    const bird = resolveMirrorBird(t, groupIndex);
    const investor = bird ? investors.find(i => i.id === bird.investorId) : null;
    return { ...t, bird, investor, dias: vencimentoDaBandeja(t) };
  }), [trays, groupIndex, investors]);

  const filtered = useMemo(() => rows.filter(r => {
    const haystack = `${r.label || ''} ${r.breedLabel || ''} ${r.speciesLabel || ''} ${r.varietyLabel || ''}`.toLowerCase();
    const matchSearch = !search.trim() || haystack.includes(search.toLowerCase());
    const matchInvestor = !filterInvestor
      || (filterInvestor === '__none__' ? !r.investor : r.investor?.id === filterInvestor);
    return matchSearch && matchInvestor;
  }), [rows, search, filterInvestor]);

  // Os mesmos quatro números do Ornabird, com os mesmos limiares (<= 3 dias
  // "vencendo", < 0 "vencida"), para as duas telas nunca discordarem.
  const totals = useMemo(() => filtered.reduce((acc, r) => {
    acc.eggs += parseInt(r.eggCount, 10) || 0;
    if (r.dias !== null && r.dias < 0) acc.vencidas += 1;
    else if (r.dias !== null && r.dias <= 3) acc.vencendo += 1;
    return acc;
  }, { eggs: 0, vencendo: 0, vencidas: 0 }), [filtered]);

  const unlinked = rows.filter(r => !r.bird).length;

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
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: unlinked > 0 ? '#fef3c7' : '#d1fae5', color: unlinked > 0 ? '#d97706' : '#059669' }}>
            <Link2 size={20} />
          </div>
          <div className="stat-label">Sem Vinculo</div>
          <div className="stat-value" style={{ color: unlinked > 0 ? 'var(--warning)' : 'var(--success)' }}>{unlinked}</div>
        </div>
      </div>

      {unlinked > 0 && (
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
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-input"
          style={{ width: 'auto', minWidth: 200 }}
          value={filterInvestor}
          onChange={e => setFilterInvestor(e.target.value)}
        >
          <option value="">Todos os investidores</option>
          {investors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          <option value="__none__">— Sem vinculo —</option>
        </select>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Bandeja</th>
                <th>Raca / Variedade</th>
                <th>Investidor</th>
                <th>Ovos</th>
                <th>Descartados</th>
                <th>Vence em</th>
                <th>Entradas</th>
              </tr>
            </thead>
            <tbody>
              {/* Mais urgente primeiro: quem vence antes precisa de decisao antes. */}
              {[...filtered]
                .sort((a, b) => {
                  if (a.dias === null) return 1;
                  if (b.dias === null) return -1;
                  return a.dias - b.dias;
                })
                .map(r => (
                  <tr key={r.id}>
                    <td><strong>{r.label || '-'}</strong></td>
                    <td style={{ fontSize: 13 }}>
                      {r.breedLabel || '-'}
                      {r.varietyLabel && <span style={{ color: 'var(--text-muted)' }}> · {r.varietyLabel}</span>}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.speciesLabel || ''}</div>
                    </td>
                    <td>
                      {r.investor ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="investor-avatar" style={{ width: 22, height: 22, fontSize: 9, borderRadius: 6 }}>
                            {getInitials(r.investor.name)}
                          </div>
                          <span style={{ fontSize: 13 }}>{r.investor.name}</span>
                        </div>
                      ) : (
                        <span className="badge" style={{ background: '#fef3c7', color: '#d97706' }}>Sem vinculo</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>{parseInt(r.eggCount, 10) || 0}</td>
                    <td style={{ color: (parseInt(r.discardedCount, 10) || 0) > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                      {parseInt(r.discardedCount, 10) || 0}
                    </td>
                    <td><EtiquetaValidade dias={r.dias} /></td>
                    {/* Uma bandeja acumula varias entradas, cada uma com sua
                        validade. O detalhe explica por que ela vence quando vence. */}
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {(r.entries || []).filter(e => (e.available ?? 0) > 0).map(e => (
                        <div key={e.id}>
                          {formatDate(e.entryDate)} · {e.available} ovo(s)
                        </div>
                      ))}
                      {(r.entries || []).filter(e => (e.available ?? 0) > 0).length === 0 && (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Espelho da prateleira do Ornabird: so bandejas ativas, so entradas que ainda
          tem ovo — as mesmas regras da tela de la. Para criar, mover ou descartar
          bandejas, use o Ornabird; as alteracoes aparecem aqui na proxima
          sincronizacao. &quot;Vencendo em breve&quot; sao 3 dias ou menos.
        </div>
      </div>
    </div>
  );
}
