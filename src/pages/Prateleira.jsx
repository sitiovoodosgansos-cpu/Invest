import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatDate, getInitials, buildOrnabirdGroupIndex, resolveMirrorBird,
} from '../utils/helpers';
import { Layers, Search, Link2, AlertCircle, Egg, Trash2 } from 'lucide-react';
import OrnabirdSync from '../components/OrnabirdSync';

// Read-only mirror of Ornabird's egg trays.
//
// Ornabird is the source of truth: trays are created and moved there, and this
// page only shows the copy the sync brings over. Nothing here writes back —
// having two places to edit the same tray would guarantee divergence.
export default function Prateleira() {
  const { investors, birds, ornabirdTrays } = useApp();
  const [search, setSearch] = useState('');
  const [filterInvestor, setFilterInvestor] = useState('');

  const trays = Array.isArray(ornabirdTrays) ? ornabirdTrays : [];

  // A tray belongs to an investor only when its Ornabird flock group has been
  // linked to a Plantel row. Unlinked trays are surfaced rather than hidden,
  // so a missing link is visible instead of silently dropping eggs.
  const groupIndex = useMemo(() => buildOrnabirdGroupIndex(birds), [birds]);
  const rows = useMemo(() => trays.map(t => {
    const bird = resolveMirrorBird(t, groupIndex);
    const investor = bird ? investors.find(i => i.id === bird.investorId) : null;
    return { ...t, bird, investor };
  }), [trays, groupIndex, investors]);

  const filtered = useMemo(() => rows.filter(r => {
    const haystack = `${r.label || ''} ${r.breedLabel || ''} ${r.speciesLabel || ''} ${r.varietyLabel || ''}`.toLowerCase();
    const matchSearch = !search.trim() || haystack.includes(search.toLowerCase());
    const matchInvestor = !filterInvestor
      || (filterInvestor === '__none__' ? !r.investor : r.investor?.id === filterInvestor);
    return matchSearch && matchInvestor;
  }), [rows, search, filterInvestor]);

  const totals = useMemo(() => filtered.reduce((acc, r) => {
    acc.eggs += parseInt(r.eggCount, 10) || 0;
    acc.discarded += parseInt(r.discardedCount, 10) || 0;
    return acc;
  }, { eggs: 0, discarded: 0 }), [filtered]);

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
          <div className="stat-card-icon" style={{ background: '#fef3c7', color: '#d97706' }}><Egg size={20} /></div>
          <div className="stat-label">Ovos na Prateleira</div>
          <div className="stat-value">{totals.eggs}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon purple"><Layers size={20} /></div>
          <div className="stat-label">Bandejas</div>
          <div className="stat-value">{filtered.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fee2e2', color: '#dc2626' }}><Trash2 size={20} /></div>
          <div className="stat-label">Descartados</div>
          <div className="stat-value" style={{ color: 'var(--danger)' }}>{totals.discarded}</div>
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
              Plantel. Abra o Plantel, edite o animal correspondente e preencha o campo
              "Vinculo com o Ornabird".
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
                <th>Situacao</th>
                <th>Entrada</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
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
                  <td>
                    <span className={`badge ${r.status === 'OPEN' ? 'badge-blue' : 'badge-purple'}`}>
                      {r.status === 'OPEN' ? 'Aberta' : (r.status || '-')}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Dados espelhados do Ornabird. Para criar, mover ou descartar bandejas, use o Ornabird —
          as alteracoes aparecem aqui na proxima sincronizacao.
        </div>
      </div>
    </div>
  );
}
