import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, calculateProfitDistribution,
  getInitials, getMonthsDifference, calculateCompoundInterest, groupSalesByPeriod
} from '../utils/helpers';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend, PieChart, Pie, Cell
} from 'recharts';
import { LogOut, Bird, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

const COLORS = ['#6C2BD9', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'];

export default function InvestorPortal() {
  const { currentUser, logout } = useAuth();
  const { investors, birds, sales, financialInvestments, payments } = useApp();
  const [period, setPeriod] = useState('monthly');
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');

  const investor = investors.find(i => i.id === currentUser.investorId);
  const distribution = useMemo(() => calculateProfitDistribution(sales, birds), [sales, birds]);

  if (!investor) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h3>Investidor nao encontrado</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>Sua conta pode ter sido removida. Entre em contato com o administrador.</p>
          <button className="btn btn-primary" onClick={logout}><LogOut size={16} /> Sair</button>
        </div>
      </div>
    );
  }

  const myBirds = birds.filter(b => b.investorId === investor.id);
  const myFinancial = financialInvestments.filter(f => f.investorId === investor.id);
  const myDistribution = distribution.distribution[investor.id];
  const mySales = myDistribution ? myDistribution.items : [];

  const totalInvested = myBirds.reduce((s, b) => s + (parseFloat(b.investmentValue) || 0), 0);
  const totalMatrices = myBirds.reduce((s, b) => s + (parseInt(b.matrixCount) || 0), 0);
  const totalBreeders = myBirds.reduce((s, b) => s + (parseInt(b.breederCount) || 0), 0);
  const totalProfit = myDistribution ? myDistribution.totalProfit : 0;

  const totalFinancialInvested = myFinancial.reduce((s, f) => s + f.amount, 0);
  const totalFinancialCurrent = myFinancial.reduce((s, f) => {
    const months = getMonthsDifference(f.date, new Date().toISOString());
    return s + calculateCompoundInterest(f.amount, 0.03, months);
  }, 0);
  const totalFinancialProfit = totalFinancialCurrent - totalFinancialInvested;

  const myPayments = (payments || []).filter(p => p.investorId === investor.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  const totalPaid = myPayments.reduce((s, p) => s + parseFloat(p.amount), 0);
  const totalAccumulated = totalFinancialProfit + totalProfit;
  const netBalance = totalAccumulated - totalPaid;

  // Timeline chart data
  const timelineData = useMemo(() => {
    if (!mySales.length) return [];
    const grouped = groupSalesByPeriod(mySales, period);
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        period: key,
        ovos: items.filter(i => i.isEgg).reduce((s, i) => s + i.profit, 0),
        aves: items.filter(i => !i.isEgg).reduce((s, i) => s + i.profit, 0),
        total: items.reduce((s, i) => s + i.profit, 0),
      }));
  }, [mySales, period]);

  // Breed breakdown chart data
  const breedData = useMemo(() => {
    if (!mySales.length) return [];
    const byBreed = {};
    mySales.forEach(item => {
      const breed = item.matchedBird || 'Outros';
      if (!byBreed[breed]) byBreed[breed] = 0;
      byBreed[breed] += item.profit;
    });
    return Object.entries(byBreed).map(([name, value]) => ({ name, value }));
  }, [mySales]);

  // Sorted sales for the detail table
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
          <button className="btn btn-secondary btn-sm" onClick={logout}>
            <LogOut size={14} /> Sair
          </button>
        </div>
      </header>

      <main className="portal-content">
        {/* Investor Summary — matches Reports.jsx layout */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div className="investor-avatar" style={{ width: 56, height: 56, fontSize: 20 }}>
              {getInitials(investor.name)}
            </div>
            <div>
              <h3 style={{ fontSize: 20, fontWeight: 700 }}>{investor.name}</h3>
              {investor.email && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{investor.email}</p>}
            </div>
          </div>

          <div className="stats-grid" style={{ marginBottom: 0 }}>
            <div className="stat-card">
              <div className="stat-label">Animais no Plantel</div>
              <div className="stat-value">{totalMatrices + totalBreeders}</div>
              <div className="stat-change positive">{totalMatrices} matrizes / {totalBreeders} reprodutores</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Investido no Plantel</div>
              <div className="stat-value" style={{ color: 'var(--primary)' }}>{formatCurrency(totalInvested)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Lucro com Ovos</div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(myDistribution?.eggProfit || 0)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Lucro com Animais</div>
              <div className="stat-value" style={{ color: 'var(--info)' }}>{formatCurrency(myDistribution?.birdProfit || 0)}</div>
            </div>
          </div>
        </div>

        {/* Financial Investments — matches Reports.jsx "Aportes Financeiros" */}
        {myFinancial.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Aportes Financeiros (3% a.m.)</span>
            </div>
            <div className="stats-grid" style={{ marginBottom: 16 }}>
              <div>
                <div className="stat-label">Total Aportado</div>
                <div className="stat-value" style={{ fontSize: 20 }}>{formatCurrency(totalFinancialInvested)}</div>
              </div>
              <div>
                <div className="stat-label">Valor Atual</div>
                <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>{formatCurrency(totalFinancialCurrent)}</div>
              </div>
              <div>
                <div className="stat-label">Rendimento</div>
                <div className="stat-value" style={{ fontSize: 20, color: 'var(--info)' }}>+{formatCurrency(totalFinancialProfit)}</div>
              </div>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Data</th><th>Valor</th><th>Meses</th><th>Atual</th><th>Rendimento</th></tr>
                </thead>
                <tbody>
                  {myFinancial.map(f => {
                    const months = getMonthsDifference(f.date, new Date().toISOString());
                    const current = calculateCompoundInterest(f.amount, 0.03, months);
                    return (
                      <tr key={f.id}>
                        <td>{formatDate(f.date)}</td>
                        <td>{formatCurrency(f.amount)}</td>
                        <td>{months}</td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(current)}</td>
                        <td style={{ color: 'var(--info)' }}>+{formatCurrency(current - f.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Balance Summary — matches Reports.jsx "Saldo do Investidor" */}
        {(myFinancial.length > 0 || totalProfit > 0 || myPayments.length > 0) && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Saldo do Investidor</span>
            </div>
            <div className="stats-grid" style={{ marginBottom: myPayments.length > 0 ? 16 : 0 }}>
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
                <div className="stat-value" style={{ fontSize: 18, color: 'var(--primary)' }}>{formatCurrency(totalAccumulated)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total Pago</div>
                <div className="stat-value" style={{ fontSize: 18, color: '#D97706' }}>{formatCurrency(totalPaid)}</div>
              </div>
            </div>

            {/* Net balance highlight */}
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

            {/* Payments table */}
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
                        <td>{p.description || '-'}</td>
                        <td style={{ color: '#D97706', fontWeight: 600 }}>{formatCurrency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Plantel do Investidor — matches Reports.jsx */}
        {myBirds.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Plantel do Investidor</span>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Especie</th><th>Raca</th><th>Matrizes</th><th>Reprodutores</th><th>Investido</th></tr>
                </thead>
                <tbody>
                  {myBirds.map(b => (
                    <tr key={b.id}>
                      <td>{b.species}</td>
                      <td><strong>{b.breed}</strong></td>
                      <td>{b.matrixCount || 0}</td>
                      <td>{b.breederCount || 0}</td>
                      <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{formatCurrency(b.investmentValue || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Charts */}
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
                      <linearGradient id="colorProfitPortal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6C2BD9" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#6C2BD9" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="period" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={v => `R$${v.toFixed(0)}`} />
                    <Tooltip formatter={v => formatCurrency(v)} />
                    <Legend />
                    <Area type="monotone" dataKey="ovos" name="Ovos" stroke="#6C2BD9" fill="url(#colorProfitPortal)" />
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
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
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

        {/* Sales details — matches Reports.jsx "Detalhamento de Vendas" */}
        {mySales.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Detalhamento de Vendas ({mySales.length} itens)</span>
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
                      Valor <SortIcon field="price" />
                    </th>
                    <th>Taxa</th>
                    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('profit')}>
                      Lucro <SortIcon field="profit" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSales.map((item, idx) => (
                    <tr key={idx}>
                      <td>{formatDate(item.date || item.importedAt)}</td>
                      <td style={{ fontSize: 12 }}>{item.orderNumber || '-'}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.itemDescription || item.item || '-'}
                      </td>
                      <td><span className={`badge ${item.isEgg ? 'badge-purple' : 'badge-blue'}`}>{item.isEgg ? 'Ovo' : 'Animal'}</span></td>
                      <td>{formatCurrency(item.totalValue)}</td>
                      <td>{(item.rate * 100).toFixed(1)}%</td>
                      <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(item.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '16px 16px 0', borderTop: '2px solid var(--border)', marginTop: 12 }}>
              <div>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lucro Ovos: </span>
                <strong style={{ color: 'var(--primary)' }}>{formatCurrency(myDistribution?.eggProfit || 0)}</strong>
              </div>
              <div>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lucro Animais: </span>
                <strong style={{ color: 'var(--info)' }}>{formatCurrency(myDistribution?.birdProfit || 0)}</strong>
              </div>
              <div>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total: </span>
                <strong style={{ color: 'var(--success)', fontSize: 16 }}>{formatCurrency(totalProfit)}</strong>
              </div>
            </div>
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
