import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, calculateProfitDistribution,
  getInitials, getMonthsDifference, calculateCompoundInterest, groupSalesByPeriod
} from '../utils/helpers';
import { exportInvestorReport } from '../utils/pdfExport';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Legend, PieChart, Pie, Cell
} from 'recharts';
import { FileDown, Eye, Users, Filter, Calendar, Link, Check, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

const COLORS = ['#6C2BD9', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'];

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function getDateFilterRange(filterType, specificMonth) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (filterType) {
    case 'today':
      return { start: todayStart, end: todayEnd, label: `Hoje (${formatDate(now.toISOString())})` };
    case '7days': {
      const start = new Date(todayStart);
      start.setDate(start.getDate() - 7);
      return { start, end: todayEnd, label: 'Ultimos 7 dias' };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end, label: `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}` };
    }
    case 'specific_month': {
      if (!specificMonth) return null;
      const [year, month] = specificMonth.split('-').map(Number);
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59, 999);
      return { start, end, label: `${MONTH_NAMES[month - 1]} ${year}` };
    }
    case 'last_year': {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      return { start, end, label: `Ano ${now.getFullYear() - 1}` };
    }
    case 'all':
    default:
      return null; // No filter
  }
}

function filterItemsByDate(items, dateRange) {
  if (!dateRange || !items) return items;
  return items.filter(item => {
    const d = new Date(item.date || item.data || item.importedAt);
    return d >= dateRange.start && d <= dateRange.end;
  });
}

// Generate month options for the dropdown (last 24 months)
function getMonthOptions() {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    options.push({ value, label });
  }
  return options;
}

export default function Reports() {
  const { investors, birds, sales, financialInvestments, payments } = useApp();
  const [selectedInvestor, setSelectedInvestor] = useState('');
  const [period, setPeriod] = useState('monthly');
  const [dateFilter, setDateFilter] = useState('all');
  const [specificMonth, setSpecificMonth] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');

  const copyInvestorLink = () => {
    if (!selectedInvestor) return;
    const baseUrl = window.location.origin + window.location.pathname;
    const link = `${baseUrl}#/portal/${selectedInvestor}`;
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds),
    [sales, birds]
  );

  const dateRange = useMemo(
    () => getDateFilterRange(dateFilter, specificMonth),
    [dateFilter, specificMonth]
  );

  const investor = investors.find(i => i.id === selectedInvestor);
  const investorBirds = birds.filter(b => b.investorId === selectedInvestor);
  const investorFinancial = financialInvestments.filter(f => f.investorId === selectedInvestor);
  const investorDist = distribution.distribution[selectedInvestor];

  // Filtered distribution (apply date filter to items)
  const filteredDist = useMemo(() => {
    if (!investorDist) return null;
    const filteredItems = filterItemsByDate(investorDist.items, dateRange);
    const eggProfit = filteredItems.filter(i => i.isEgg).reduce((s, i) => s + i.profit, 0);
    const birdProfit = filteredItems.filter(i => !i.isEgg).reduce((s, i) => s + i.profit, 0);
    return {
      items: filteredItems,
      eggProfit,
      birdProfit,
      totalProfit: eggProfit + birdProfit,
    };
  }, [investorDist, dateRange]);

  // Sort distribution items
  const sortedDistItems = useMemo(() => {
    if (!filteredDist || !filteredDist.items.length) return [];
    const items = [...filteredDist.items];
    const dir = sortDirection === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      switch (sortField) {
        case 'date': {
          const da = new Date(a.date || a.importedAt || 0).getTime();
          const db = new Date(b.date || b.importedAt || 0).getTime();
          return (da - db) * dir;
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
  }, [filteredDist, sortField, sortDirection]);

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

  const investorPayments = useMemo(() =>
    (payments || []).filter(p => p.investorId === selectedInvestor).sort((a, b) => new Date(b.date) - new Date(a.date)),
    [payments, selectedInvestor]
  );

  const totalBirdInvestment = investorBirds.reduce((s, b) => s + (parseFloat(b.investmentValue) || 0), 0);
  const totalMatrices = investorBirds.reduce((s, b) => s + (parseInt(b.matrixCount) || 0), 0);
  const totalBreeders = investorBirds.reduce((s, b) => s + (parseInt(b.breederCount) || 0), 0);

  const financialSummary = useMemo(() => {
    return investorFinancial.reduce((acc, f) => {
      const months = getMonthsDifference(f.date);
      const current = calculateCompoundInterest(parseFloat(f.amount), 0.03, months);
      return { invested: acc.invested + parseFloat(f.amount), current: acc.current + current };
    }, { invested: 0, current: 0 });
  }, [investorFinancial]);

  const balanceSummary = useMemo(() => {
    const totalPaid = investorPayments.reduce((s, p) => s + parseFloat(p.amount), 0);
    const salesProfit = filteredDist ? filteredDist.totalProfit : 0;
    const totalAccumulated = financialSummary.current + salesProfit;
    const netBalance = totalAccumulated - totalPaid;
    return { totalPaid, salesProfit, totalAccumulated, netBalance };
  }, [investorPayments, financialSummary, filteredDist]);

  // Timeline for investor (uses filtered data)
  const timelineData = useMemo(() => {
    if (!filteredDist) return [];
    const grouped = groupSalesByPeriod(filteredDist.items, period);
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        period: key,
        ovos: items.filter(i => i.isEgg).reduce((s, i) => s + i.profit, 0),
        aves: items.filter(i => !i.isEgg).reduce((s, i) => s + i.profit, 0),
        total: items.reduce((s, i) => s + i.profit, 0),
      }));
  }, [filteredDist, period]);

  // Breed profit breakdown (uses filtered data)
  const breedData = useMemo(() => {
    if (!filteredDist) return [];
    const byBreed = {};
    filteredDist.items.forEach(item => {
      const breed = item.matchedBird || 'Outros';
      if (!byBreed[breed]) byBreed[breed] = 0;
      byBreed[breed] += item.profit;
    });
    const sorted = Object.entries(byBreed)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    if (sorted.length <= 5) return sorted;
    const top5 = sorted.slice(0, 5);
    const othersValue = sorted.slice(5).reduce((s, d) => s + d.value, 0);
    if (othersValue > 0) top5.push({ name: 'Outros', value: othersValue });
    return top5;
  }, [filteredDist]);

  const handleExportPDF = () => {
    if (!investor) return;
    try {
      const periodLabel = dateRange ? dateRange.label : 'Todos os periodos';
      exportInvestorReport(investor, birds, sales, financialInvestments, filteredDist, periodLabel, payments);
    } catch (err) {
      console.error('Erro ao exportar PDF:', err);
      alert('Erro ao gerar o PDF. Tente novamente.');
    }
  };

  const monthOptions = useMemo(() => getMonthOptions(), []);

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Relatorios</h2>
        <p>Visualize e exporte relatorios individuais por investidor</p>
      </div>

      <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <select
          className="form-input"
          style={{ width: 'auto', minWidth: 250 }}
          value={selectedInvestor}
          onChange={e => setSelectedInvestor(e.target.value)}
        >
          <option value="">Selecione um investidor</option>
          {investors.map(i => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>

        {selectedInvestor && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-card)', borderRadius: 10, padding: '4px 6px', border: '1px solid var(--border-light)' }}>
              <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
              <select
                className="form-input"
                style={{ width: 'auto', minWidth: 160, border: 'none', background: 'transparent', padding: '6px 8px' }}
                value={dateFilter}
                onChange={e => { setDateFilter(e.target.value); if (e.target.value !== 'specific_month') setSpecificMonth(''); }}
              >
                <option value="all">Todos os periodos</option>
                <option value="today">Hoje</option>
                <option value="7days">Ultimos 7 dias</option>
                <option value="last_month">Ultimo mes</option>
                <option value="specific_month">Mes especifico</option>
                <option value="last_year">Ultimo ano</option>
              </select>

              {dateFilter === 'specific_month' && (
                <select
                  className="form-input"
                  style={{ width: 'auto', minWidth: 160, border: 'none', background: 'transparent', padding: '6px 8px' }}
                  value={specificMonth}
                  onChange={e => setSpecificMonth(e.target.value)}
                >
                  <option value="">Selecione o mes</option>
                  {monthOptions.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              )}
            </div>

            {dateRange && (
              <span className="badge badge-purple" style={{ fontSize: 12, padding: '6px 12px' }}>
                <Filter size={12} style={{ marginRight: 4 }} />
                {dateRange.label}
              </span>
            )}

            <button className="btn btn-primary" onClick={handleExportPDF}>
              <FileDown size={16} /> Exportar PDF
            </button>
            <button
              className="btn"
              onClick={copyInvestorLink}
              style={{
                background: linkCopied ? 'var(--success)' : 'var(--primary)',
                color: '#fff',
                border: 'none',
              }}
            >
              {linkCopied ? <Check size={16} /> : <Link size={16} />}
              {linkCopied ? 'Link copiado!' : 'Copiar link do investidor'}
            </button>
          </>
        )}
      </div>

      {!selectedInvestor ? (
        <div className="empty-state">
          <Users size={48} />
          <h3>Selecione um investidor</h3>
          <p>Escolha um investidor para visualizar seu relatorio individual</p>
        </div>
      ) : (
        <>
          {/* Investor Summary */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div className="investor-avatar" style={{ width: 56, height: 56, fontSize: 20 }}>
                {getInitials(investor?.name)}
              </div>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 700 }}>{investor?.name}</h3>
                {investor?.email && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{investor.email}</p>}
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
                <div className="stat-value" style={{ color: 'var(--primary)' }}>{formatCurrency(totalBirdInvestment)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Lucro com Ovos</div>
                <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(filteredDist?.eggProfit || 0)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Lucro com Animais</div>
                <div className="stat-value" style={{ color: 'var(--info)' }}>{formatCurrency(filteredDist?.birdProfit || 0)}</div>
              </div>
            </div>
          </div>

          {/* Financial */}
          {investorFinancial.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">
                <span className="card-title">Aportes Financeiros (3% a.m.)</span>
              </div>
              <div className="stats-grid" style={{ marginBottom: 16 }}>
                <div>
                  <div className="stat-label">Total Aportado</div>
                  <div className="stat-value" style={{ fontSize: 20 }}>{formatCurrency(financialSummary.invested)}</div>
                </div>
                <div>
                  <div className="stat-label">Valor Atual</div>
                  <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>{formatCurrency(financialSummary.current)}</div>
                </div>
                <div>
                  <div className="stat-label">Rendimento</div>
                  <div className="stat-value" style={{ fontSize: 20, color: 'var(--info)' }}>+{formatCurrency(financialSummary.current - financialSummary.invested)}</div>
                </div>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>Data</th><th>Valor</th><th>Meses</th><th>Atual</th><th>Rendimento</th></tr>
                  </thead>
                  <tbody>
                    {investorFinancial.map(f => {
                      const months = getMonthsDifference(f.date);
                      const current = calculateCompoundInterest(parseFloat(f.amount), 0.03, months);
                      return (
                        <tr key={f.id}>
                          <td>{formatDate(f.date)}</td>
                          <td>{formatCurrency(f.amount)}</td>
                          <td>{months}</td>
                          <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(current)}</td>
                          <td style={{ color: 'var(--info)' }}>+{formatCurrency(current - parseFloat(f.amount))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Balance Summary */}
          {(investorFinancial.length > 0 || (filteredDist && filteredDist.totalProfit > 0) || investorPayments.length > 0) && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">
                <span className="card-title">Saldo do Investidor</span>
              </div>
              <div className="stats-grid" style={{ marginBottom: investorPayments.length > 0 ? 16 : 0 }}>
                <div className="stat-card">
                  <div className="stat-label">Rendimento do Aporte</div>
                  <div className="stat-value" style={{ fontSize: 18, color: 'var(--info)' }}>+{formatCurrency(financialSummary.current - financialSummary.invested)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Lucro com Vendas</div>
                  <div className="stat-value" style={{ fontSize: 18, color: 'var(--success)' }}>{formatCurrency(balanceSummary.salesProfit)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total Acumulado</div>
                  <div className="stat-value" style={{ fontSize: 18, color: 'var(--primary)' }}>{formatCurrency(balanceSummary.totalAccumulated)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total Pago</div>
                  <div className="stat-value" style={{ fontSize: 18, color: '#D97706' }}>{formatCurrency(balanceSummary.totalPaid)}</div>
                </div>
              </div>

              {/* Net balance highlight */}
              <div style={{
                background: balanceSummary.netBalance >= 0 ? 'var(--success-bg, #ecfdf5)' : 'var(--danger-bg, #fef2f2)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: investorPayments.length > 0 ? 16 : 0,
              }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Saldo Liquido</span>
                <span style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: balanceSummary.netBalance >= 0 ? 'var(--success)' : 'var(--danger)',
                }}>
                  {formatCurrency(balanceSummary.netBalance)}
                </span>
              </div>

              {/* Payments table */}
              {investorPayments.length > 0 && (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr><th>Data</th><th>Descricao</th><th>Valor Pago</th></tr>
                    </thead>
                    <tbody>
                      {investorPayments.map(p => (
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

          {/* Birds */}
          {investorBirds.length > 0 && (
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
                    {investorBirds.map(b => (
                      <tr key={b.id}>
                        <td>{b.species}</td>
                        <td><strong>{b.breed}</strong></td>
                        <td>{b.matrixCount || 0}</td>
                        <td>{b.breederCount || 0}</td>
                        <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{formatCurrency(b.investmentValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="grid-2">
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
                        <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6C2BD9" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#6C2BD9" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="period" fontSize={11} />
                      <YAxis fontSize={11} tickFormatter={v => `R$${v.toFixed(0)}`} />
                      <Tooltip formatter={v => formatCurrency(v)} />
                      <Legend />
                      <Area type="monotone" dataKey="ovos" name="Ovos" stroke="#6C2BD9" fill="url(#colorProfit)" />
                      <Area type="monotone" dataKey="aves" name="Animais" stroke="#3B82F6" fill="none" strokeDasharray="5 5" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state"><p>Sem dados de lucro{dateRange ? ` para ${dateRange.label}` : ''}</p></div>
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

          {/* Sales details */}
          {filteredDist && filteredDist.items.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-header">
                <span className="card-title">Detalhamento de Vendas ({filteredDist.items.length} itens)</span>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('date')}>
                        Data <SortIcon field="date" />
                      </th>
                      <th>Pedido</th>
                      <th>Item</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('type')}>
                        Tipo <SortIcon field="type" />
                      </th>
                      <th>Raca</th>
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
                    {sortedDistItems.map((item, idx) => (
                      <tr key={idx}>
                        <td>{formatDate(item.date || item.importedAt)}</td>
                        <td style={{ fontSize: 12 }}>{item.orderNumber || '-'}</td>
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.itemDescription || '-'}
                        </td>
                        <td><span className={`badge ${item.isEgg ? 'badge-purple' : 'badge-blue'}`}>{item.isEgg ? 'Ovo' : 'Animal'}</span></td>
                        <td>{item.matchedBird || '-'}</td>
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
                  <strong style={{ color: 'var(--primary)' }}>{formatCurrency(filteredDist.eggProfit)}</strong>
                </div>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lucro Animais: </span>
                  <strong style={{ color: 'var(--info)' }}>{formatCurrency(filteredDist.birdProfit)}</strong>
                </div>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total: </span>
                  <strong style={{ color: 'var(--success)', fontSize: 16 }}>{formatCurrency(filteredDist.totalProfit)}</strong>
                </div>
              </div>
            </div>
          )}

          {filteredDist && filteredDist.items.length === 0 && dateRange && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="empty-state">
                <Calendar size={36} />
                <h3>Nenhuma venda no periodo</h3>
                <p>Nao ha vendas registradas para "{dateRange.label}". Tente outro periodo.</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
