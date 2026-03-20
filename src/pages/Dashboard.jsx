import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, calculateProfitDistribution, getMonthsDifference,
  calculateCompoundInterest, groupSalesByPeriod
} from '../utils/helpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';
import {
  Users, Bird, TrendingUp, DollarSign, Egg, Thermometer, Baby,
  Heart, ShoppingCart, Receipt, Activity, Skull, Home, Shield
} from 'lucide-react';

const COLORS = ['#6C2BD9', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'];
const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function Dashboard() {
  const {
    investors, birds, sales, financialInvestments, expenses,
    eggCollections, incubatorBatches, incubators,
    nurseryRooms, nurseryBatches, nurseryEvents,
    infirmaryBays, infirmaryAdmissions, treatments,
  } = useApp();

  const [period, setPeriod] = useState('monthly');

  const allCollections = eggCollections || [];
  const allIncBatches = incubatorBatches || [];
  const allNurseryBatches = nurseryBatches || [];
  const allNurseryEvents = nurseryEvents || [];
  const allAdmissions = infirmaryAdmissions || [];
  const allTreatments = treatments || [];
  const allExpenses = expenses || [];

  // ── Financial stats ──
  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds),
    [sales, birds]
  );

  const totalProfit = useMemo(() => {
    return Object.values(distribution.distribution).reduce((sum, d) => sum + d.totalProfit, 0);
  }, [distribution]);

  const totalSalesRevenue = useMemo(() => {
    return (sales || []).reduce((s, sale) => {
      return s + (sale.items || []).reduce((is, item) => is + (parseFloat(item.totalValue) || 0), 0);
    }, 0);
  }, [sales]);

  const totalExpenses = useMemo(() => {
    return allExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
  }, [allExpenses]);

  const totalMatrices = birds.reduce((s, b) => s + (parseInt(b.matrixCount) || 0), 0);
  const totalBreeders = birds.reduce((s, b) => s + (parseInt(b.breederCount) || 0), 0);

  // ── Egg collection stats ──
  const eggStats = useMemo(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
    const monthAgo = new Date(now); monthAgo.setDate(now.getDate() - 30);

    const todayEggs = allCollections.filter(c => c.date === today).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
    const weekEggs = allCollections.filter(c => c.date && new Date(c.date) >= weekAgo).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
    const monthEggs = allCollections.filter(c => c.date && new Date(c.date) >= monthAgo).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
    const totalEggs = allCollections.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);

    // Monthly egg chart (last 6 months)
    const monthlyEggs = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const dEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const eggs = allCollections
        .filter(c => c.date && c.date.startsWith(key))
        .reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      monthlyEggs.push({ month: MONTH_NAMES[d.getMonth()], ovos: eggs });
    }

    return { todayEggs, weekEggs, monthEggs, totalEggs, monthlyEggs };
  }, [allCollections]);

  // ── Incubator stats ──
  const hatchStats = useMemo(() => {
    const hatched = allIncBatches.filter(b => b.status === 'hatched');
    const incubating = allIncBatches.filter(b => b.status === 'incubating');
    const totalHatched = hatched.reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);
    const totalEggs = hatched.reduce((s, b) => s + (parseInt(b.totalEggs) || 0), 0);
    const hatchRate = totalEggs > 0 ? Math.round((totalHatched / totalEggs) * 100) : 0;
    return { totalHatched, hatchRate, incubatingCount: incubating.length, totalBatches: allIncBatches.length };
  }, [allIncBatches]);

  // ── Nursery stats ──
  const nurseryStats = useMemo(() => {
    const activeBatches = allNurseryBatches.filter(b => b.status === 'active');
    const totalChicksNow = activeBatches.reduce((s, b) => {
      const entered = parseInt(b.quantityIn) || 0;
      const deaths = allNurseryEvents.filter(e => e.batchId === b.id && e.type === 'death').reduce((s2, e) => s2 + (parseInt(e.quantity) || 0), 0);
      const sales = allNurseryEvents.filter(e => e.batchId === b.id && e.type === 'sale').reduce((s2, e) => s2 + (parseInt(e.quantity) || 0), 0);
      const transfers = allNurseryEvents.filter(e => e.batchId === b.id && e.type === 'transfer').reduce((s2, e) => s2 + (parseInt(e.quantity) || 0), 0);
      return s + (entered - deaths - sales - transfers);
    }, 0);
    const totalDeaths = allNurseryEvents.filter(e => e.type === 'death').reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
    const totalEntered = allNurseryBatches.reduce((s, b) => s + (parseInt(b.quantityIn) || 0), 0);
    const survivalRate = totalEntered > 0 ? Math.round(((totalEntered - totalDeaths) / totalEntered) * 100) : 0;
    return { totalChicksNow, activeBatches: activeBatches.length, totalDeaths, survivalRate };
  }, [allNurseryBatches, allNurseryEvents]);

  // ── Health stats ──
  const healthStats = useMemo(() => {
    const activeAdmissions = allAdmissions.filter(a => a.status === 'active').length;
    const recovered = allAdmissions.filter(a => a.status === 'recovered').length;
    const died = allAdmissions.filter(a => a.status === 'died').length;
    const recoveryRate = (recovered + died) > 0 ? Math.round((recovered / (recovered + died)) * 100) : 0;
    return { activeAdmissions, recovered, died, recoveryRate, totalTreatments: allTreatments.length };
  }, [allAdmissions, allTreatments]);

  // ── Monthly overview chart (eggs, hatched, expenses, sales) ──
  const monthlyOverview = useMemo(() => {
    const now = new Date();
    const data = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const eggs = allCollections.filter(c => c.date && c.date.startsWith(key))
        .reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      const hatched = allIncBatches.filter(b => b.status === 'hatched' && b.dateHatch && b.dateHatch.startsWith(key))
        .reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);
      const deaths = allNurseryEvents.filter(e => e.type === 'death' && e.date && e.date.startsWith(key))
        .reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);

      data.push({ month: MONTH_NAMES[d.getMonth()], ovos: eggs, nascidos: hatched, obitos: deaths });
    }
    return data;
  }, [allCollections, allIncBatches, allNurseryEvents]);

  // ── Species distribution pie ──
  const speciesData = useMemo(() => {
    const counts = {};
    birds.forEach(b => {
      counts[b.species] = (counts[b.species] || 0) + (parseInt(b.matrixCount) || 0) + (parseInt(b.breederCount) || 0);
    });
    const sorted = Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    if (sorted.length <= 5) return sorted;
    const top5 = sorted.slice(0, 5);
    const othersValue = sorted.slice(5).reduce((s, d) => s + d.value, 0);
    if (othersValue > 0) top5.push({ name: 'Outros', value: othersValue });
    return top5;
  }, [birds]);

  // ── Sales timeline ──
  const timelineData = useMemo(() => {
    const allItems = Object.values(distribution.distribution).flatMap(d => d.items);
    if (allItems.length === 0) return [];
    const grouped = groupSalesByPeriod(allItems, period);
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({
        period: key,
        lucro: items.reduce((s, i) => s + i.profit, 0),
        vendas: items.reduce((s, i) => s + (parseFloat(i.totalValue) || 0), 0),
      }));
  }, [distribution, period]);

  // ── Monthly financial chart ──
  const monthlyFinancial = useMemo(() => {
    const now = new Date();
    const data = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const monthExpenses = allExpenses.filter(e => e.date && e.date.startsWith(key))
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

      // Sales revenue for the month
      const monthSales = (sales || []).filter(s => {
        const saleDate = s.date || s.importedAt || '';
        return saleDate.startsWith(key);
      }).reduce((s, sale) => {
        return s + (sale.items || []).reduce((is, item) => is + (parseFloat(item.totalValue) || 0), 0);
      }, 0);

      data.push({ month: MONTH_NAMES[d.getMonth()], receita: monthSales, despesas: monthExpenses });
    }
    return data;
  }, [allExpenses, sales]);

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Visão geral do Sítio Voo dos Gansos</p>
      </div>

      {/* ── Row 1: Main operational stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-card-icon green"><Bird size={20} /></div>
          <div className="stat-label">Plantel</div>
          <div className="stat-value">{totalMatrices + totalBreeders}</div>
          <div className="stat-change" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{totalMatrices} matr. / {totalBreeders} repr.</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fef3c7', color: '#d97706' }}><Egg size={20} /></div>
          <div className="stat-label">Ovos Semana</div>
          <div className="stat-value">{eggStats.weekEggs}</div>
          <div className="stat-change" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Hoje: {eggStats.todayEggs}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#dbeafe', color: '#2563eb' }}><Thermometer size={20} /></div>
          <div className="stat-label">Nascidos</div>
          <div className="stat-value">{hatchStats.totalHatched}</div>
          <div className="stat-change" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{hatchStats.incubatingCount} incubando</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fef3c7', color: '#f59e0b' }}><Baby size={20} /></div>
          <div className="stat-label">Pintinhos</div>
          <div className="stat-value">{nurseryStats.totalChicksNow}</div>
          <div className="stat-change" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{nurseryStats.activeBatches} lotes ativos</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fce7f3', color: '#ec4899' }}><Heart size={20} /></div>
          <div className="stat-label">Enfermaria</div>
          <div className="stat-value">{healthStats.activeAdmissions}</div>
          <div className="stat-change" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Recup: {healthStats.recoveryRate}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon orange"><TrendingUp size={20} /></div>
          <div className="stat-label">Receita Vendas</div>
          <div className="stat-value" style={{ fontSize: 18 }}>{formatCurrency(totalSalesRevenue)}</div>
        </div>
      </div>

      {/* ── Row 2: Charts - Production overview + Species ── */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Produção Mensal (6 meses)</span>
          </div>
          {monthlyOverview.some(d => d.ovos > 0 || d.nascidos > 0) ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyOverview}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="ovos" name="Ovos Coletados" fill="#6C2BD9" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="nascidos" name="Pintinhos Nascidos" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="obitos" name="Óbitos Pintinhos" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state"><p>Registre coletas e chocagens para ver a produção</p></div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Plantel por Espécie</span>
          </div>
          {speciesData.length > 0 ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={speciesData} cx="50%" cy="50%" outerRadius={90} dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {speciesData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state"><p>Cadastre aves no plantel</p></div>
          )}
        </div>
      </div>

      {/* ── Row 3: Operational indicators ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        {/* Egg collection card */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Egg size={18} style={{ color: '#6C2BD9' }} />
            <h4 style={{ fontSize: 14, margin: 0 }}>Coleta de Ovos</h4>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Hoje</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#6C2BD9' }}>{eggStats.todayEggs}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Semana</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{eggStats.weekEggs}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Mês</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{eggStats.monthEggs}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Total</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{eggStats.totalEggs}</div>
            </div>
          </div>
        </div>

        {/* Incubator card */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Thermometer size={18} style={{ color: '#f59e0b' }} />
            <h4 style={{ fontSize: 14, margin: 0 }}>Chocadeiras</h4>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Chocadeiras</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{(incubators || []).length}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Incubando</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>{hatchStats.incubatingCount}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Nascidos</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>{hatchStats.totalHatched}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Taxa Eclosão</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: hatchStats.hatchRate >= 70 ? '#10b981' : hatchStats.hatchRate >= 50 ? '#f59e0b' : '#ef4444' }}>{hatchStats.hatchRate}%</div>
            </div>
          </div>
        </div>

        {/* Nursery card */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Baby size={18} style={{ color: '#3b82f6' }} />
            <h4 style={{ fontSize: 14, margin: 0 }}>Pintinhos</h4>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Salas</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{(nurseryRooms || []).length}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Ativos</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>{nurseryStats.totalChicksNow}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Óbitos</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{nurseryStats.totalDeaths}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Sobrev.</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: nurseryStats.survivalRate >= 80 ? '#10b981' : '#f59e0b' }}>{nurseryStats.survivalRate}%</div>
            </div>
          </div>
        </div>

        {/* Health card */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Heart size={18} style={{ color: '#ec4899' }} />
            <h4 style={{ fontSize: 14, margin: 0 }}>Sanidade</h4>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Internadas</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>{healthStats.activeAdmissions}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Recuperadas</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>{healthStats.recovered}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Óbitos</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{healthStats.died}</div>
            </div>
            <div style={{ textAlign: 'center', padding: 8, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Tratamentos</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#6C2BD9' }}>{healthStats.totalTreatments}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 4: Financial charts ── */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Receita x Despesas (6 meses)</span>
          </div>
          {monthlyFinancial.some(d => d.receita > 0 || d.despesas > 0) ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyFinancial}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={v => formatCurrency(v)} />
                  <Legend />
                  <Bar dataKey="receita" name="Receita" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="despesas" name="Despesas" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state"><p>Registre vendas e despesas para ver o gráfico</p></div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Evolução de Lucros</span>
            <div className="period-selector">
              {['daily', 'weekly', 'monthly', 'yearly'].map(p => (
                <button key={p} className={`period-btn ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>
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
            <div className="empty-state"><p>Importe vendas para visualizar a evolução</p></div>
          )}
        </div>
      </div>

      {/* ── Row 5: Financial summary cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-card-icon purple"><Users size={20} /></div>
          <div className="stat-label">Investidores</div>
          <div className="stat-value">{investors.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon blue"><DollarSign size={20} /></div>
          <div className="stat-label">Investido em Aves</div>
          <div className="stat-value" style={{ fontSize: 18 }}>{formatCurrency(birds.reduce((s, b) => s + (parseFloat(b.investmentValue) || 0), 0))}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon green"><TrendingUp size={20} /></div>
          <div className="stat-label">Lucro Distribuído</div>
          <div className="stat-value" style={{ fontSize: 18, color: 'var(--success)' }}>{formatCurrency(totalProfit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fee2e2', color: '#ef4444' }}><Receipt size={20} /></div>
          <div className="stat-label">Total Despesas</div>
          <div className="stat-value" style={{ fontSize: 18, color: '#ef4444' }}>{formatCurrency(totalExpenses)}</div>
        </div>
      </div>
    </div>
  );
}
