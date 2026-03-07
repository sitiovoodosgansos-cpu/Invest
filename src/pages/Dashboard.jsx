import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, calculateProfitDistribution, getMonthsDifference,
  calculateCompoundInterest, groupSalesByPeriod
} from '../utils/helpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend, AreaChart, Area
} from 'recharts';
import { Users, Bird, TrendingUp, DollarSign } from 'lucide-react';

const COLORS = ['#6C2BD9', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'];

export default function Dashboard() {
  const { investors, birds, sales, financialInvestments } = useApp();
  const [period, setPeriod] = useState('monthly');

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds),
    [sales, birds]
  );

  const totalBirdInvestment = useMemo(
    () => birds.reduce((sum, b) => sum + (parseFloat(b.investmentValue) || 0), 0),
    [birds]
  );

  const totalFinancialInvestment = useMemo(() => {
    return financialInvestments.reduce((sum, f) => {
      const months = getMonthsDifference(f.date);
      return sum + calculateCompoundInterest(parseFloat(f.amount), 0.03, months);
    }, 0);
  }, [financialInvestments]);

  const totalProfit = useMemo(() => {
    return Object.values(distribution.distribution).reduce((sum, d) => sum + d.totalProfit, 0);
  }, [distribution]);

  const totalMatrices = birds.reduce((s, b) => s + (parseInt(b.matrixCount) || 0), 0);
  const totalBreeders = birds.reduce((s, b) => s + (parseInt(b.breederCount) || 0), 0);

  // Chart data: profit by investor
  const investorProfitData = useMemo(() => {
    return investors.map(inv => {
      const d = distribution.distribution[inv.id];
      return {
        name: inv.name.split(' ')[0],
        ovos: d ? d.eggProfit : 0,
        aves: d ? d.birdProfit : 0,
        total: d ? d.totalProfit : 0,
      };
    }).filter(d => d.total > 0);
  }, [investors, distribution]);

  // Pie chart: birds by species
  const speciesData = useMemo(() => {
    const counts = {};
    birds.forEach(b => {
      counts[b.species] = (counts[b.species] || 0) + (parseInt(b.matrixCount) || 0) + (parseInt(b.breederCount) || 0);
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [birds]);

  // Timeline data
  const timelineData = useMemo(() => {
    const allItems = Object.values(distribution.distribution).flatMap(d => d.items);
    const grouped = groupSalesByPeriod(allItems, period);
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        period: key,
        lucro: items.reduce((s, i) => s + i.profit, 0),
        vendas: items.reduce((s, i) => s + (parseFloat(i.totalValue) || 0), 0),
      }));
  }, [distribution, period]);

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Visao geral dos investimentos do Sitio Voo dos Gansos</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon purple"><Users size={20} /></div>
          <div className="stat-label">Investidores</div>
          <div className="stat-value">{investors.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon green"><Bird size={20} /></div>
          <div className="stat-label">Plantel Total</div>
          <div className="stat-value">{totalMatrices + totalBreeders}</div>
          <div className="stat-change positive">{totalMatrices} matrizes / {totalBreeders} reprodutores</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon blue"><DollarSign size={20} /></div>
          <div className="stat-label">Investido em Aves</div>
          <div className="stat-value">{formatCurrency(totalBirdInvestment)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon orange"><TrendingUp size={20} /></div>
          <div className="stat-label">Lucro Distribuido</div>
          <div className="stat-value">{formatCurrency(totalProfit)}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Lucro por Investidor</span>
          </div>
          {investorProfitData.length > 0 ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={investorProfitData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={v => `R$${v.toFixed(0)}`} />
                  <Tooltip formatter={v => formatCurrency(v)} />
                  <Legend />
                  <Bar dataKey="ovos" name="Ovos" fill="#6C2BD9" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="aves" name="Aves" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state">
              <p>Importe vendas para ver os lucros</p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Plantel por Especie</span>
          </div>
          {speciesData.length > 0 ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={speciesData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {speciesData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state">
              <p>Cadastre aves no plantel</p>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">Evolucao de Lucros</span>
          <div className="period-selector">
            {['daily', 'weekly', 'biweekly', 'monthly', 'yearly'].map(p => (
              <button
                key={p}
                className={`period-btn ${period === p ? 'active' : ''}`}
                onClick={() => setPeriod(p)}
              >
                {{ daily: 'Diario', weekly: 'Semanal', biweekly: 'Quinzenal', monthly: 'Mensal', yearly: 'Anual' }[p]}
              </button>
            ))}
          </div>
        </div>
        {timelineData.length > 0 ? (
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData}>
                <defs>
                  <linearGradient id="colorLucro" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6C2BD9" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#6C2BD9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="period" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={v => `R$${v.toFixed(0)}`} />
                <Tooltip formatter={v => formatCurrency(v)} />
                <Legend />
                <Area type="monotone" dataKey="lucro" name="Lucro" stroke="#6C2BD9" fill="url(#colorLucro)" strokeWidth={2} />
                <Area type="monotone" dataKey="vendas" name="Vendas" stroke="#3B82F6" fill="none" strokeWidth={2} strokeDasharray="5 5" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="empty-state">
            <p>Importe vendas para visualizar a evolucao</p>
          </div>
        )}
      </div>

      {totalFinancialInvestment > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Aportes Financeiros</span>
          </div>
          <div className="stats-grid" style={{ marginBottom: 0 }}>
            <div>
              <div className="stat-label">Total Aportado</div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {formatCurrency(financialInvestments.reduce((s, f) => s + parseFloat(f.amount), 0))}
              </div>
            </div>
            <div>
              <div className="stat-label">Valor Atual (3% a.m.)</div>
              <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>
                {formatCurrency(totalFinancialInvestment)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
