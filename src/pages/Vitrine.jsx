import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, formatPercent, getInitials,
  buildOrnabirdGroupIndex, resolveMirrorBird, resolveRateFor,
} from '../utils/helpers';
import { Store, Search, Link2, AlertCircle, DollarSign, TrendingUp } from 'lucide-react';

// Read-only mirror of Ornabird's vitrine sales.
//
// This is the page that replaces guesswork. Today Invest attributes a sale by
// looking for the breed name inside the description (matchSaleToBird), which
// misfires when two breeds have similar names. A mirrored sale arrives already
// carrying the flock group it came from, so the owner is resolved exactly.
export default function Vitrine() {
  const {
    investors, birds, ornabirdVitrine,
    eggProfitRate, birdProfitRate,
  } = useApp();
  const [search, setSearch] = useState('');
  const [filterInvestor, setFilterInvestor] = useState('');

  const globals = { eggProfitRate, birdProfitRate };
  const sales = Array.isArray(ornabirdVitrine) ? ornabirdVitrine : [];

  const groupIndex = useMemo(() => buildOrnabirdGroupIndex(birds), [birds]);

  const rows = useMemo(() => sales.map(s => {
    const bird = resolveMirrorBird(s, groupIndex);
    const investor = bird ? investors.find(i => i.id === bird.investorId) : null;
    const amount = Number(s.amount) || 0;
    // The investor's cut uses the same rules as every other sale: the animal's
    // own rate when it has one, otherwise the global rate.
    const rate = resolveRateFor(bird, !!s.isEgg, globals);
    return { ...s, bird, investor, amount, rate, profit: investor ? amount * rate : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sales, groupIndex, investors, eggProfitRate, birdProfitRate]);

  const filtered = useMemo(() => rows.filter(r => {
    const haystack = `${r.description || ''} ${r.customer || ''}`.toLowerCase();
    const matchSearch = !search.trim() || haystack.includes(search.toLowerCase());
    const matchInvestor = !filterInvestor
      || (filterInvestor === '__none__' ? !r.investor : r.investor?.id === filterInvestor);
    return matchSearch && matchInvestor;
  }), [rows, search, filterInvestor]);

  const totals = useMemo(() => filtered.reduce((acc, r) => {
    acc.amount += r.amount;
    acc.profit += r.profit;
    acc.quantity += parseInt(r.quantity, 10) || 0;
    return acc;
  }, { amount: 0, profit: 0, quantity: 0 }), [filtered]);

  const unlinked = rows.filter(r => !r.bird).length;
  const uncertain = rows.filter(r => r.matchedBy === 'title').length;

  if (sales.length === 0) {
    return (
      <div className="animate-in">
        <div className="page-header">
          <h2>Vitrine</h2>
          <p>Vendas da vitrine espelhadas do Ornabird</p>
        </div>
        <div className="empty-state">
          <Store size={48} />
          <h3>Nenhuma venda sincronizada</h3>
          <p style={{ maxWidth: 460, margin: '0 auto' }}>
            Esta pagina espelha as vendas da vitrine do Ornabird, ja vinculadas ao lote
            de origem. Elas aparecem aqui depois que a sincronizacao estiver ligada e os
            lotes do Plantel estiverem vinculados.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Vitrine</h2>
        <p>Vendas espelhadas do Ornabird, vinculadas ao lote de origem — somente leitura</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon purple"><Store size={20} /></div>
          <div className="stat-label">Vendas</div>
          <div className="stat-value">{filtered.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon green"><DollarSign size={20} /></div>
          <div className="stat-label">Valor Total</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(totals.amount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon blue"><TrendingUp size={20} /></div>
          <div className="stat-label">Lucro dos Investidores</div>
          <div className="stat-value" style={{ color: 'var(--info)' }}>{formatCurrency(totals.profit)}</div>
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
            <strong>{unlinked} venda(s) sem investidor.</strong>
            <div style={{ marginTop: 2 }}>
              Essas vendas nao geram lucro para ninguem enquanto o lote de origem no
              Ornabird nao for vinculado a uma linha do Plantel.
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
            placeholder="Buscar anuncio ou cliente..."
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
                <th>Data</th>
                <th>Anuncio</th>
                <th>Investidor</th>
                <th>Tipo</th>
                <th>Qtd</th>
                <th>Valor</th>
                <th>Taxa</th>
                <th>Lucro</th>
                <th>Cliente</th>
              </tr>
            </thead>
            <tbody>
              {[...filtered]
                .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                .map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 13 }}>{formatDate(r.date)}</td>
                    <td style={{ maxWidth: 220 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {r.matchedBy === 'title' && (
                          <span
                            className="badge"
                            style={{ background: '#fef3c7', color: '#d97706', flexShrink: 0, fontSize: 10 }}
                            title="Vinculo deduzido pelo titulo no Ornabird — confira"
                          >
                            ?
                          </span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.description || '-'}
                        </span>
                      </div>
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
                    <td>
                      <span className={`badge ${r.isEgg ? 'badge-purple' : 'badge-blue'}`}>
                        {r.isEgg ? 'Ovo' : 'Ave'}
                      </span>
                    </td>
                    <td>{parseInt(r.quantity, 10) || 1}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(r.amount)}</td>
                    <td style={{ fontSize: 13 }}>{formatPercent(r.rate)}</td>
                    <td style={{ color: r.investor ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {r.investor ? formatCurrency(r.profit) : '-'}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{r.customer || '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Dados espelhados do Ornabird. O lucro usa a taxa propria do animal quando houver,
          senao a taxa geral.
          {uncertain > 0 && ` ${uncertain} venda(s) marcada(s) com "?" tiveram o lote deduzido pelo titulo no Ornabird — vale conferir.`}
        </div>
      </div>
    </div>
  );
}
