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
import { FileDown, Eye, Users, Filter } from 'lucide-react';

const COLORS = ['#6C2BD9', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'];

export default function Reports() {
  const { investors, birds, sales, financialInvestments } = useApp();
  const [selectedInvestor, setSelectedInvestor] = useState('');
  const [period, setPeriod] = useState('monthly');

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds),
    [sales, birds]
  );

  const investor = investors.find(i => i.id === selectedInvestor);
  const investorBirds = birds.filter(b => b.investorId === selectedInvestor);
  const investorFinancial = financialInvestments.filter(f => f.investorId === selectedInvestor);
  const investorDist = distribution.distribution[selectedInvestor];

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

  // Timeline for investor
  const timelineData = useMemo(() => {
    if (!investorDist) return [];
    const grouped = groupSalesByPeriod(investorDist.items, period);
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        period: key,
        ovos: items.filter(i => i.isEgg).reduce((s, i) => s + i.profit, 0),
        aves: items.filter(i => !i.isEgg).reduce((s, i) => s + i.profit, 0),
        total: items.reduce((s, i) => s + i.profit, 0),
      }));
  }, [investorDist, period]);

  // Breed profit breakdown
  const breedData = useMemo(() => {
    if (!investorDist) return [];
    const byBreed = {};
    investorDist.items.forEach(item => {
      const breed = item.matchedBird || 'Outros';
      if (!byBreed[breed]) byBreed[breed] = 0;
      byBreed[breed] += item.profit;
    });
    return Object.entries(byBreed).map(([name, value]) => ({ name, value }));
  }, [investorDist]);

  const handleExportPDF = () => {
    if (!investor) return;
    exportInvestorReport(investor, birds, sales, financialInvestments, investorDist);
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Relatorios</h2>
        <p>Visualize e exporte relatorios individuais por investidor</p>
      </div>

      <div className="filter-bar">
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
          <button className="btn btn-primary" onClick={handleExportPDF}>
            <FileDown size={16} /> Exportar PDF
          </button>
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
                <div className="stat-label">Aves no Plantel</div>
                <div className="stat-value">{totalMatrices + totalBreeders}</div>
                <div className="stat-change positive">{totalMatrices} matrizes / {totalBreeders} reprodutores</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Investido em Aves</div>
                <div className="stat-value" style={{ color: 'var(--primary)' }}>{formatCurrency(totalBirdInvestment)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Lucro com Ovos</div>
                <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(investorDist?.eggProfit || 0)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Lucro com Aves</div>
                <div className="stat-value" style={{ color: 'var(--info)' }}>{formatCurrency(investorDist?.birdProfit || 0)}</div>
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
                      <Area type="monotone" dataKey="aves" name="Aves" stroke="#3B82F6" fill="none" strokeDasharray="5 5" />
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

          {/* Sales details */}
          {investorDist && investorDist.items.length > 0 && (
            <div className="card" style={{ marginTop: 24 }}>
              <div className="card-header">
                <span className="card-title">Detalhamento de Vendas ({investorDist.items.length} itens)</span>
              </div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr><th>Data</th><th>Item</th><th>Tipo</th><th>Raca</th><th>Valor</th><th>Taxa</th><th>Lucro</th></tr>
                  </thead>
                  <tbody>
                    {investorDist.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{formatDate(item.date || item.importedAt)}</td>
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.itemDescription || '-'}
                        </td>
                        <td><span className={`badge ${item.isEgg ? 'badge-purple' : 'badge-blue'}`}>{item.isEgg ? 'Ovo' : 'Ave'}</span></td>
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
                  <strong style={{ color: 'var(--primary)' }}>{formatCurrency(investorDist.eggProfit)}</strong>
                </div>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Lucro Aves: </span>
                  <strong style={{ color: 'var(--info)' }}>{formatCurrency(investorDist.birdProfit)}</strong>
                </div>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total: </span>
                  <strong style={{ color: 'var(--success)', fontSize: 16 }}>{formatCurrency(investorDist.totalProfit)}</strong>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
