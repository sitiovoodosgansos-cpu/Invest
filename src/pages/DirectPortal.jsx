import React, { useState, useMemo, useEffect, Component } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, calculateProfitDistribution,
  getInitials, getMonthsDifference, calculateCompoundInterest, groupSalesByPeriod
} from '../utils/helpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend, PieChart, Pie, Cell
} from 'recharts';
import { Bird, Wallet, TrendingUp, DollarSign, Send, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

const COLORS = ['#6C2BD9', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'];

// ErrorBoundary to prevent blank page on crash
class PortalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="login-page">
          <div className="login-card" style={{ textAlign: 'center' }}>
            <div className="login-logo"><Bird size={28} /></div>
            <h3>Erro ao carregar portal</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
              Ocorreu um erro ao carregar os dados. Tente novamente.
            </p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Recarregar</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function DirectPortalContent() {
  const { token } = useParams();
  const appData = useApp();
  const [period, setPeriod] = useState('monthly');

  // Defensive data access - ensure arrays are always arrays
  const investors = Array.isArray(appData.investors) ? appData.investors : [];
  const birds = Array.isArray(appData.birds) ? appData.birds : [];
  const sales = Array.isArray(appData.sales) ? appData.sales : [];
  const financialInvestments = Array.isArray(appData.financialInvestments) ? appData.financialInvestments : [];
  const payments = Array.isArray(appData.payments) ? appData.payments : [];
  const loading = appData.loading;
  const firestoreError = appData.firestoreError;

  // Phase 2B: resolve the URL token against /shareTokens first. If the lookup
  // succeeds and the doc is tagged type=='investor', we use the stored
  // investorId to find the investor record. If the lookup fails we keep the
  // raw token value for the legacy fallback path below, so links generated
  // before Phase 2B (which used investor.id as the token) keep working until
  // the admin explicitly generates a new portal token for that investor.
  const [resolvedInvestorId, setResolvedInvestorId] = useState(null);
  const [tokenChecked, setTokenChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setTokenChecked(true);
      return undefined;
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'shareTokens', token));
        if (cancelled) return;
        if (snap.exists() && snap.data().type === 'investor') {
          setResolvedInvestorId(snap.data().investorId || null);
        } else {
          setResolvedInvestorId(null);
        }
      } catch {
        if (!cancelled) setResolvedInvestorId(null);
      } finally {
        if (!cancelled) setTokenChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Resolve the investor record. Order of preference:
  //   1) Canonical path — /shareTokens/{token}.investorId matches an investor.
  //   2) Legacy fallback — token matches investor.id AND that investor has
  //      never been migrated to a portalTokenId. Once the admin generates a
  //      portal token the legacy URL stops working for that investor.
  const investor = useMemo(() => {
    if (!tokenChecked) return null;
    if (resolvedInvestorId) {
      return investors.find(i => i.id === resolvedInvestorId) || null;
    }
    const legacyMatch = investors.find(i => i.id === token);
    if (legacyMatch && !legacyMatch.portalTokenId) return legacyMatch;
    return null;
  }, [tokenChecked, resolvedInvestorId, investors, token]);

  const distribution = useMemo(() => {
    try {
      return calculateProfitDistribution(sales, birds);
    } catch {
      return { distribution: {}, unmatchedSales: [] };
    }
  }, [sales, birds]);

  // ALL derived data computed here (before any early return) to respect Rules of Hooks
  const myBirds = useMemo(() => investor ? birds.filter(b => b.investorId === investor.id) : [], [birds, investor]);
  const myFinancial = useMemo(() => investor ? financialInvestments.filter(f => f.investorId === investor.id) : [], [financialInvestments, investor]);
  const myDistribution = investor ? distribution.distribution[investor.id] : null;
  const mySales = myDistribution ? (myDistribution.items || []) : [];

  const totalInvested = myBirds.reduce((s, b) => s + (parseFloat(b.investmentValue) || 0), 0);
  const totalMatrices = myBirds.reduce((s, b) => s + (parseInt(b.matrixCount) || 0), 0);
  const totalBreeders = myBirds.reduce((s, b) => s + (parseInt(b.breederCount) || 0), 0);
  const totalProfit = myDistribution ? myDistribution.totalProfit : 0;

  const totalFinancialInvested = myFinancial.reduce((s, f) => s + (parseFloat(f.amount) || 0), 0);
  const totalFinancialCurrent = myFinancial.reduce((s, f) => {
    const months = getMonthsDifference(f.date);
    return s + calculateCompoundInterest(parseFloat(f.amount) || 0, 0.03, months);
  }, 0);
  const totalFinancialProfit = totalFinancialCurrent - totalFinancialInvested;

  const myPayments = useMemo(() => {
    if (!investor) return [];
    return payments.filter(p => p.investorId === investor.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [payments, investor]);
  const totalPaid = myPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  // Total Acumulado = Rendimento do Aporte + Lucro com Vendas (exclui principal investido)
  const netBalance = totalFinancialProfit + totalProfit - totalPaid;

  // Timeline chart data
  const timelineData = useMemo(() => {
    try {
      if (!mySales.length) return [];
      const grouped = groupSalesByPeriod(mySales, period);
      return Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, items]) => ({
          period: key,
          ovos: items.filter(i => i.isEgg).reduce((s, i) => s + (i.profit || 0), 0),
          aves: items.filter(i => !i.isEgg).reduce((s, i) => s + (i.profit || 0), 0),
          total: items.reduce((s, i) => s + (i.profit || 0), 0),
        }));
    } catch {
      return [];
    }
  }, [mySales, period]);

  // Breed breakdown chart data — top 5 by profit, rest grouped as "Outros"
  const breedData = useMemo(() => {
    try {
      if (!mySales.length) return [];
      const byBreed = {};
      mySales.forEach(item => {
        const breed = item.matchedBird || 'Outros';
        if (!byBreed[breed]) byBreed[breed] = 0;
        byBreed[breed] += (item.profit || 0);
      });
      const entries = Object.entries(byBreed)
        .map(([name, value]) => ({ name, value }))
        .filter(e => e.value > 0)
        .sort((a, b) => b.value - a.value);
      if (entries.length <= 5) return entries;
      const top5 = entries.slice(0, 5);
      const rest = entries.slice(5);
      const outrosValue = rest.reduce((s, e) => s + e.value, 0);
      if (outrosValue > 0) top5.push({ name: 'Outros', value: outrosValue });
      return top5;
    } catch {
      return [];
    }
  }, [mySales]);

  // Sorted sales for the detail table
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');

  const sortedSales = useMemo(() => {
    if (!mySales.length) return [];
    const items = [...mySales];
    const dir = sortDirection === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      switch (sortField) {
        case 'date': {
          const da = new Date(a.date || a.importedAt || 0).getTime();
          const db = new Date(b.date || b.importedAt || 0).getTime();
          return (da - db) * dir;
        }
        case 'order': {
          const oa = String(a.orderNumber || '');
          const ob = String(b.orderNumber || '');
          return oa.localeCompare(ob, undefined, { numeric: true }) * dir;
        }
        case 'item': {
          const ia = String(a.itemDescription || a.item || '');
          const ib = String(b.itemDescription || b.item || '');
          return ia.localeCompare(ib) * dir;
        }
        case 'type': {
          const ta = a.isEgg ? 0 : 1;
          const tb = b.isEgg ? 0 : 1;
          return (ta - tb) * dir;
        }
        case 'price':
          return ((a.totalValue || 0) - (b.totalValue || 0)) * dir;
        case 'rate':
          return ((a.rate || 0) - (b.rate || 0)) * dir;
        case 'profit':
          return ((a.profit || 0) - (b.profit || 0)) * dir;
        default:
          return 0;
      }
    });
    return items;
  }, [mySales, sortField, sortDirection]);

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown size={12} style={{ opacity: 0.3, marginLeft: 4 }} />;
    return sortDirection === 'asc'
      ? <ArrowUp size={12} style={{ marginLeft: 4, color: 'var(--primary)' }} />
      : <ArrowDown size={12} style={{ marginLeft: 4, color: 'var(--primary)' }} />;
  };

  // === EARLY RETURNS (after all hooks) ===

  if (loading || !tokenChecked) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: 12, background: '#f8fafc' }}>
        <div style={{ width: 36, height: 36, border: '3px solid #E2E8F0', borderTopColor: '#6C2BD9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: '#64748B', fontSize: 14 }}>Carregando portal do investidor...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (firestoreError) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div className="login-logo"><Bird size={28} /></div>
          <h3>Erro de conexao</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            Nao foi possivel carregar os dados. Tente novamente em alguns instantes.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Tentar novamente</button>
        </div>
      </div>
    );
  }

  if (!investor) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div className="login-logo"><Bird size={28} /></div>
          <h3>Link invalido</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            Este link de acesso nao foi encontrado. Solicite um novo link ao administrador.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Tentar novamente</button>
        </div>
      </div>
    );
  }

  return (
    <div className="investor-portal">
      {/* Header */}
      <header className="portal-header">
        <div className="portal-header-left">
          <div className="portal-logo">
            <Bird size={22} />
          </div>
          <div>
            <h1>Sitio Voo dos Gansos</h1>
            <span>Painel do Investidor</span>
          </div>
        </div>
        <div className="portal-header-right">
          <div className="portal-user">
            <div className="investor-avatar" style={{ width: 36, height: 36, fontSize: 13 }}>{getInitials(investor.name)}</div>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{investor.name}</span>
          </div>
        </div>
      </header>

      <main className="portal-content">
        {/* Summary Stats */}
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-card-icon purple"><Bird size={20} /></div>
            <div className="stat-label">Plantel</div>
            <div className="stat-value">{myBirds.length} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>especies</span></div>
            <div className="stat-change" style={{ color: 'var(--text-secondary)' }}>{totalMatrices} matrizes / {totalBreeders} reprodutores</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon blue"><Wallet size={20} /></div>
            <div className="stat-label">Total Investido</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{formatCurrency(totalInvested + totalFinancialInvested)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon green"><TrendingUp size={20} /></div>
            <div className="stat-label">Lucro com Vendas</div>
            <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>{formatCurrency(totalProfit)}</div>
            <div className="stat-change" style={{ color: 'var(--text-secondary)' }}>{mySales.length} vendas vinculadas</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon orange"><DollarSign size={20} /></div>
            <div className="stat-label">Rendimento Financeiro</div>
            <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>{formatCurrency(totalFinancialProfit)}</div>
            <div className="stat-change" style={{ color: 'var(--text-secondary)' }}>3% a.m. juros compostos</div>
          </div>
        </div>

        {/* My Birds */}
        {myBirds.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Meu Plantel</span>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Especie / Raca</th>
                    <th>Matrizes</th>
                    <th>Reprodutores</th>
                    <th>Valor Investido</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {myBirds.map(b => (
                    <tr key={b.id}>
                      <td><strong>{b.species} - {b.breed}</strong></td>
                      <td>{b.matrixCount || 0}</td>
                      <td>{b.breederCount || 0}</td>
                      <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{formatCurrency(b.investmentValue || 0)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDate(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Financial Investments */}
        {myFinancial.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Aportes Financeiros (3% a.m.)</span>
            </div>
            <div className="stats-grid" style={{ marginBottom: 16 }}>
              <div className="stat-card">
                <div className="stat-label">Total Aportado</div>
                <div className="stat-value" style={{ fontSize: 20 }}>{formatCurrency(totalFinancialInvested)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Valor Atual</div>
                <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>{formatCurrency(totalFinancialCurrent)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Rendimento Total</div>
                <div className="stat-value" style={{ fontSize: 20, color: 'var(--info)' }}>+{formatCurrency(totalFinancialProfit)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total Pago</div>
                <div className="stat-value" style={{ fontSize: 20, color: '#D97706' }}>{formatCurrency(totalPaid)}</div>
              </div>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Valor Aportado</th>
                    <th>Periodo</th>
                    <th>Valor Atual</th>
                    <th>Rendimento</th>
                  </tr>
                </thead>
                <tbody>
                  {myFinancial.map(f => {
                    const months = getMonthsDifference(f.date);
                    const current = calculateCompoundInterest(parseFloat(f.amount) || 0, 0.03, months);
                    return (
                      <tr key={f.id}>
                        <td>{formatDate(f.date)}</td>
                        <td>{formatCurrency(f.amount)}</td>
                        <td>{months} meses</td>
                        <td style={{ fontWeight: 600 }}>{formatCurrency(current)}</td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(current - (parseFloat(f.amount) || 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Saldo do Investidor — full balance breakdown mirroring Reports page */}
        {(myFinancial.length > 0 || totalProfit > 0 || myPayments.length > 0) && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Saldo do Investidor</span>
            </div>
            <div className="stats-grid" style={{ marginBottom: 16 }}>
              <div className="stat-card">
                <div className="stat-label">Rendimento do Aporte</div>
                <div className="stat-value" style={{ fontSize: 18, color: 'var(--info)' }}>+{formatCurrency(totalFinancialProfit)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Lucro com Vendas</div>
                <div className="stat-value" style={{ fontSize: 18, color: 'var(--success)' }}>{formatCurrency(totalProfit)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total Acumulado</div>
                <div className="stat-value" style={{ fontSize: 18, color: 'var(--primary)' }}>{formatCurrency(totalFinancialProfit + totalProfit)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total Pago</div>
                <div className="stat-value" style={{ fontSize: 18, color: '#D97706' }}>{formatCurrency(totalPaid)}</div>
              </div>
            </div>

            <div style={{
              background: netBalance >= 0 ? 'var(--success-bg, #ecfdf5)' : 'var(--danger-bg, #fef2f2)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: myPayments.length > 0 ? 16 : 0,
            }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Saldo Liquido</span>
              <span style={{
                fontSize: 20,
                fontWeight: 700,
                color: netBalance >= 0 ? 'var(--success)' : 'var(--danger)',
              }}>
                {formatCurrency(netBalance)}
              </span>
            </div>

            {myPayments.length > 0 && (
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>Data</th><th>Descricao</th><th>Valor Pago</th></tr>
                  </thead>
                  <tbody>
                    {myPayments.map(p => (
                      <tr key={p.id}>
                        <td>{formatDate(p.date)}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{p.description || '-'}</td>
                        <td style={{ color: '#D97706', fontWeight: 600 }}>{formatCurrency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Charts */}
        {mySales.length > 0 && (
          <div className="grid-2" style={{ marginBottom: 24 }}>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Evolucao de Lucros</span>
                <div className="period-selector">
                  {['daily', 'weekly', 'monthly', 'yearly'].map(p => (
                    <button
                      key={p}
                      className={`period-btn ${period === p ? 'active' : ''}`}
                      onClick={() => setPeriod(p)}
                    >
                      {{ daily: 'D', weekly: 'S', monthly: 'M', yearly: 'A' }[p]}
                    </button>
                  ))}
                </div>
              </div>
              {timelineData.length > 0 ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData}>
                      <defs>
                        <linearGradient id="colorProfitDirect" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6C2BD9" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#6C2BD9" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="period" fontSize={11} />
                      <YAxis fontSize={11} tickFormatter={v => `R$${(v || 0).toFixed(0)}`} />
                      <Tooltip formatter={v => formatCurrency(v)} />
                      <Legend />
                      <Area type="monotone" dataKey="ovos" name="Ovos" stroke="#6C2BD9" fill="url(#colorProfitDirect)" />
                      <Area type="monotone" dataKey="aves" name="Animais" stroke="#3B82F6" fill="none" strokeDasharray="5 5" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state"><p>Sem dados de lucro</p></div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Lucro por Raca</span>
              </div>
              {breedData.length > 0 ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={breedData}
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                      >
                        {breedData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={v => formatCurrency(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state"><p>Sem dados de lucro por raca</p></div>
              )}
            </div>
          </div>
        )}

        {/* Sales / Profit Distribution */}
        {mySales.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Vendas Vinculadas ({mySales.length})</span>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('date')}>
                      Data <SortIcon field="date" />
                    </th>
                    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('order')}>
                      Pedido <SortIcon field="order" />
                    </th>
                    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('item')}>
                      Item <SortIcon field="item" />
                    </th>
                    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('type')}>
                      Tipo <SortIcon field="type" />
                    </th>
                    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('price')}>
                      Valor Venda <SortIcon field="price" />
                    </th>
                    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('rate')}>
                      Taxa <SortIcon field="rate" />
                    </th>
                    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('profit')}>
                      Seu Lucro <SortIcon field="profit" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSales.map((item, idx) => (
                    <tr key={idx}>
                      <td>{formatDate(item.date || item.importedAt)}</td>
                      <td style={{ fontSize: 12 }}>{item.orderNumber || '-'}</td>
                      <td>{item.itemDescription || item.item || '-'}</td>
                      <td>
                        <span className={`badge ${item.isEgg ? 'badge-purple' : 'badge-blue'}`}>
                          {item.isEgg ? 'Ovo' : 'Ave'}
                        </span>
                      </td>
                      <td>{formatCurrency(item.totalValue)}</td>
                      <td>{((item.rate || 0) * 100).toFixed(1)}%</td>
                      <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(item.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {myDistribution && (
              <div style={{ padding: '12px 16px', background: 'var(--primary-bg)', borderRadius: 'var(--radius-sm)', marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13 }}>
                  Ovos: <strong style={{ color: 'var(--primary)' }}>{formatCurrency(myDistribution.eggProfit || 0)}</strong>
                  {' | '}
                  Aves: <strong style={{ color: 'var(--info)' }}>{formatCurrency(myDistribution.birdProfit || 0)}</strong>
                </span>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>Total: {formatCurrency(totalProfit)}</span>
              </div>
            )}
          </div>
        )}


        {myBirds.length === 0 && myFinancial.length === 0 && mySales.length === 0 && (
          <div className="empty-state">
            <Bird size={48} />
            <h3>Nenhum investimento registrado</h3>
            <p>Seus dados aparecerão aqui assim que o administrador registrar seus investimentos.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function DirectPortal() {
  return (
    <PortalErrorBoundary>
      <DirectPortalContent />
    </PortalErrorBoundary>
  );
}
