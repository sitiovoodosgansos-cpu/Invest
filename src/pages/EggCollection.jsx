import React, { useState, useMemo } from 'react';
import { useApp, BIRD_SPECIES } from '../context/AppContext';
import { formatDate } from '../utils/helpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  Plus, Trash2, Edit2, Egg, TrendingUp, AlertTriangle, Calendar,
  ChevronDown, ChevronUp, Target, Award, Save, X
} from 'lucide-react';

const MONTH_NAMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

function getWeekNumber(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = d - start;
  return Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
}

function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay();
  const startOfWeek = new Date(d);
  startOfWeek.setDate(d.getDate() - day);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  const fmt = (dt) => `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(startOfWeek)} - ${fmt(endOfWeek)}`;
}

export default function EggCollection() {
  const {
    birds, eggCollections, customSpecies,
    addEggCollection, updateEggCollection, deleteEggCollection,
    updateBird,
  } = useApp();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filterBird, setFilterBird] = useState('all');
  const [periodView, setPeriodView] = useState('week');
  const [expandedBird, setExpandedBird] = useState(null);
  const [showBirdConfigModal, setShowBirdConfigModal] = useState(null);
  const [birdConfigForm, setBirdConfigForm] = useState({ annualEggPotential: '', ringNumber: '', ringColor: '', notes: '' });
  // Batch collection: date + per-bird quantities
  const [batchDate, setBatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchEntries, setBatchEntries] = useState({});
  const [batchNotes, setBatchNotes] = useState('');
  // Single edit form (for editing existing records)
  const [editForm, setEditForm] = useState({ date: '', birdId: '', quantity: '', cracked: '0', notes: '' });

  const allCollections = eggCollections || [];

  // Merge built-in + custom species for display
  const allSpecies = useMemo(() => {
    const merged = BIRD_SPECIES.map(s => {
      const custom = (customSpecies || []).find(c => c.species.toLowerCase() === s.species.toLowerCase());
      if (custom) {
        const extraBreeds = custom.breeds.filter(b => !s.breeds.includes(b));
        return extraBreeds.length > 0 ? { ...s, breeds: [...s.breeds, ...extraBreeds] } : s;
      }
      return s;
    });
    const extras = (customSpecies || []).filter(
      c => !BIRD_SPECIES.some(s => s.species.toLowerCase() === c.species.toLowerCase())
    );
    return [...merged, ...extras];
  }, [customSpecies]);

  // Get bird label
  const getBirdLabel = (bird) => `${bird.species} - ${bird.breed}`;

  // Period calculations
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const weekCollections = useMemo(() =>
    allCollections.filter(c => new Date(c.date) >= startOfWeek),
    [allCollections, startOfWeek.getTime()]
  );
  const monthCollections = useMemo(() =>
    allCollections.filter(c => new Date(c.date) >= startOfMonth),
    [allCollections, startOfMonth.getTime()]
  );
  const yearCollections = useMemo(() =>
    allCollections.filter(c => new Date(c.date) >= startOfYear),
    [allCollections, startOfYear.getTime()]
  );

  const weekTotal = weekCollections.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
  const weekCracked = weekCollections.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
  const monthTotal = monthCollections.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
  const monthCracked = monthCollections.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
  const yearTotal = yearCollections.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
  const yearCracked = yearCollections.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);

  // Filtered collections for the table
  const filteredCollections = useMemo(() => {
    let list = [...allCollections];
    if (filterBird !== 'all') list = list.filter(c => c.birdId === filterBird);
    return list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [allCollections, filterBird]);

  // Performance analysis per bird
  const birdPerformance = useMemo(() => {
    const perf = {};
    birds.forEach(bird => {
      const birdCollections = allCollections.filter(c => c.birdId === bird.id);
      const totalEggs = birdCollections.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      const totalCracked = birdCollections.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
      const weekEggs = birdCollections.filter(c => new Date(c.date) >= startOfWeek).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      const monthEggs = birdCollections.filter(c => new Date(c.date) >= startOfMonth).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      const yearEggs = birdCollections.filter(c => new Date(c.date) >= startOfYear).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);

      const annualPotential = parseInt(bird.annualEggPotential) || 0;
      const matrices = parseInt(bird.matrixCount) || 1;
      const totalAnnualPotential = annualPotential * matrices;

      // Calculate days since first collection or bird creation
      const firstDate = birdCollections.length > 0
        ? new Date(birdCollections.reduce((min, c) => c.date < min ? c.date : min, birdCollections[0].date))
        : null;

      // Performance percentages based on proportion
      let weekPerf = 0, monthPerf = 0, yearPerf = 0;
      if (totalAnnualPotential > 0) {
        const weeklyPotential = (totalAnnualPotential / 52);
        const monthlyPotential = (totalAnnualPotential / 12);
        weekPerf = weeklyPotential > 0 ? (weekEggs / weeklyPotential) * 100 : 0;
        monthPerf = monthlyPotential > 0 ? (monthEggs / monthlyPotential) * 100 : 0;
        yearPerf = totalAnnualPotential > 0 ? (yearEggs / totalAnnualPotential) * 100 : 0;
      }

      perf[bird.id] = {
        bird,
        totalEggs,
        totalCracked,
        weekEggs,
        monthEggs,
        yearEggs,
        annualPotential: totalAnnualPotential,
        weekPerf: Math.min(weekPerf, 999),
        monthPerf: Math.min(monthPerf, 999),
        yearPerf: Math.min(yearPerf, 999),
        collectionCount: birdCollections.length,
      };
    });
    return perf;
  }, [birds, allCollections, startOfWeek.getTime(), startOfMonth.getTime(), startOfYear.getTime()]);

  // Chart data - eggs per week for the last 8 weeks
  const chartData = useMemo(() => {
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay() - (i * 7));
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);

      const weekEggs = allCollections
        .filter(c => {
          const d = new Date(c.date);
          return d >= weekStart && d < weekEnd;
        });

      const total = weekEggs.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      const cracked = weekEggs.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);

      weeks.push({
        period: `S${getWeekNumber(weekStart)}`,
        bons: total - cracked,
        trincados: cracked,
        total,
      });
    }
    return weeks;
  }, [allCollections]);

  // Monthly chart
  const monthlyChartData = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
      const mCollections = allCollections.filter(c => {
        const d = new Date(c.date);
        return d >= m && d <= mEnd;
      });
      const total = mCollections.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      const cracked = mCollections.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
      months.push({
        period: MONTH_NAMES[m.getMonth()],
        bons: total - cracked,
        trincados: cracked,
        total,
      });
    }
    return months;
  }, [allCollections]);

  const handleBatchSubmit = (e) => {
    e.preventDefault();
    // Create one collection per bird that has quantity > 0
    const entries = Object.entries(batchEntries).filter(([, v]) => (parseInt(v.quantity) || 0) > 0);
    if (entries.length === 0) return;
    entries.forEach(([birdId, entry]) => {
      addEggCollection({
        date: batchDate,
        birdId,
        quantity: parseInt(entry.quantity) || 0,
        cracked: parseInt(entry.cracked) || 0,
        notes: batchNotes.trim(),
      });
    });
    setBatchEntries({});
    setBatchNotes('');
    setBatchDate(new Date().toISOString().slice(0, 10));
    setShowModal(false);
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (!editForm.birdId || !editForm.quantity) return;
    updateEggCollection(editingId, {
      date: editForm.date,
      birdId: editForm.birdId,
      quantity: parseInt(editForm.quantity) || 0,
      cracked: parseInt(editForm.cracked) || 0,
      notes: editForm.notes.trim(),
    });
    setEditingId(null);
    setShowModal(false);
  };

  const handleEdit = (collection) => {
    setEditForm({
      date: collection.date,
      birdId: collection.birdId,
      quantity: String(collection.quantity),
      cracked: String(collection.cracked || 0),
      notes: collection.notes || '',
    });
    setEditingId(collection.id);
    setShowModal(true);
  };

  const updateBatchEntry = (birdId, field, value) => {
    setBatchEntries(prev => ({
      ...prev,
      [birdId]: { ...(prev[birdId] || { quantity: '', cracked: '' }), [field]: value },
    }));
  };

  const batchTotal = useMemo(() => {
    return Object.values(batchEntries).reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
  }, [batchEntries]);

  const batchCrackedTotal = useMemo(() => {
    return Object.values(batchEntries).reduce((s, e) => s + (parseInt(e.cracked) || 0), 0);
  }, [batchEntries]);

  const handleDelete = (id) => {
    if (window.confirm('Remover esta coleta?')) deleteEggCollection(id);
  };

  const handleBirdConfig = (bird) => {
    setBirdConfigForm({
      annualEggPotential: bird.annualEggPotential || '',
      ringNumber: bird.ringNumber || '',
      ringColor: bird.ringColor || '',
      notes: bird.birdNotes || '',
    });
    setShowBirdConfigModal(bird.id);
  };

  const handleSaveBirdConfig = () => {
    updateBird(showBirdConfigModal, {
      annualEggPotential: birdConfigForm.annualEggPotential,
      ringNumber: birdConfigForm.ringNumber,
      ringColor: birdConfigForm.ringColor,
      birdNotes: birdConfigForm.notes,
    });
    setShowBirdConfigModal(null);
  };

  const getPerfColor = (perf) => {
    if (perf >= 80) return 'var(--success)';
    if (perf >= 50) return 'var(--warning)';
    if (perf > 0) return 'var(--danger)';
    return 'var(--text-muted)';
  };

  const getPerfLabel = (perf) => {
    if (perf >= 90) return 'Excelente';
    if (perf >= 70) return 'Bom';
    if (perf >= 50) return 'Regular';
    if (perf > 0) return 'Baixo';
    return '-';
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Coleta de Ovos</h2>
        <p>Controle diario de coleta e desempenho de postura</p>
      </div>

      {/* Summary Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fef3c7', color: '#d97706' }}><Egg size={20} /></div>
          <div className="stat-label">Semana</div>
          <div className="stat-value">{weekTotal}</div>
          {weekCracked > 0 && <div className="stat-change" style={{ color: 'var(--danger)', fontSize: 11 }}>{weekCracked} trincados</div>}
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#dbeafe', color: '#2563eb' }}><Calendar size={20} /></div>
          <div className="stat-label">Mes</div>
          <div className="stat-value">{monthTotal}</div>
          {monthCracked > 0 && <div className="stat-change" style={{ color: 'var(--danger)', fontSize: 11 }}>{monthCracked} trincados</div>}
        </div>
        <div className="stat-card">
          <div className="stat-card-icon green"><TrendingUp size={20} /></div>
          <div className="stat-label">Ano</div>
          <div className="stat-value">{yearTotal}</div>
          {yearCracked > 0 && <div className="stat-change" style={{ color: 'var(--danger)', fontSize: 11 }}>{yearCracked} trincados</div>}
        </div>
        <div className="stat-card">
          <div className="stat-card-icon purple"><Target size={20} /></div>
          <div className="stat-label">Total Coletas</div>
          <div className="stat-value">{allCollections.length}</div>
        </div>
      </div>

      {/* Charts */}
      {allCollections.length > 0 && (
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Coleta Semanal</span>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="period" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="bons" name="Bons" fill="#10B981" stackId="a" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="trincados" name="Trincados" fill="#EF4444" stackId="a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Coleta Mensal</span>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="period" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="bons" name="Bons" fill="#3B82F6" stackId="a" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="trincados" name="Trincados" fill="#EF4444" stackId="a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Bird Performance Cards */}
      {birds.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">Desempenho por Raca / Ave</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, padding: 16 }}>
            {birds.map(bird => {
              const perf = birdPerformance[bird.id];
              if (!perf) return null;
              const isExpanded = expandedBird === bird.id;
              const hasConfig = parseInt(bird.annualEggPotential) > 0;
              const matrices = parseInt(bird.matrixCount) || 1;

              return (
                <div key={bird.id} style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 16,
                  background: 'var(--bg-card)',
                }}>
                  {/* Bird header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: 'var(--primary-bg)', color: 'var(--primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                      }}>
                        <Egg size={18} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{bird.species} - {bird.breed}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {matrices} {matrices > 1 ? 'matrizes' : 'matriz'}
                          {bird.ringNumber && (
                            <span style={{
                              marginLeft: 6,
                              padding: '1px 6px',
                              borderRadius: 8,
                              fontSize: 10,
                              fontWeight: 600,
                              background: bird.ringColor ? bird.ringColor + '30' : '#e2e8f0',
                              color: bird.ringColor || 'var(--text-secondary)',
                              border: bird.ringColor ? `1px solid ${bird.ringColor}` : '1px solid var(--border)',
                            }}>
                              Anilha: {bird.ringNumber}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" title="Configurar ave" onClick={() => handleBirdConfig(bird)} style={{ color: 'var(--primary)' }}>
                        <Edit2 size={14} />
                      </button>
                      <button className="btn-icon" onClick={() => setExpandedBird(isExpanded ? null : bird.id)}>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Semana</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{perf.weekEggs}</div>
                      {hasConfig && <div style={{ fontSize: 10, fontWeight: 600, color: getPerfColor(perf.weekPerf) }}>{perf.weekPerf.toFixed(0)}%</div>}
                    </div>
                    <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Mes</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{perf.monthEggs}</div>
                      {hasConfig && <div style={{ fontSize: 10, fontWeight: 600, color: getPerfColor(perf.monthPerf) }}>{perf.monthPerf.toFixed(0)}%</div>}
                    </div>
                    <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Ano</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{perf.yearEggs}</div>
                      {hasConfig && <div style={{ fontSize: 10, fontWeight: 600, color: getPerfColor(perf.yearPerf) }}>{perf.yearPerf.toFixed(0)}%</div>}
                    </div>
                  </div>

                  {/* Performance bar */}
                  {hasConfig && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Potencial anual: {perf.annualPotential} ovos ({matrices} x {bird.annualEggPotential})
                        </span>
                        <span style={{ fontWeight: 600, color: getPerfColor(perf.yearPerf) }}>{getPerfLabel(perf.yearPerf)}</span>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(perf.yearPerf, 100)}%`,
                          height: '100%',
                          background: getPerfColor(perf.yearPerf),
                          borderRadius: 3,
                          transition: 'width 0.3s',
                        }} />
                      </div>
                    </div>
                  )}

                  {!hasConfig && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AlertTriangle size={12} /> Configure o potencial anual de ovos para ver a analise de desempenho
                    </div>
                  )}

                  {perf.totalCracked > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AlertTriangle size={12} /> {perf.totalCracked} ovos trincados no total
                    </div>
                  )}

                  {/* Expanded details */}
                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      {bird.birdNotes && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontStyle: 'italic' }}>
                          {bird.birdNotes}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span>Total de ovos coletados:</span>
                          <strong style={{ color: 'var(--text-primary)' }}>{perf.totalEggs}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span>Total de coletas:</span>
                          <strong style={{ color: 'var(--text-primary)' }}>{perf.collectionCount}</strong>
                        </div>
                        {perf.totalCracked > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span>Ovos trincados:</span>
                            <strong style={{ color: 'var(--danger)' }}>{perf.totalCracked} ({perf.totalEggs > 0 ? ((perf.totalCracked / perf.totalEggs) * 100).toFixed(1) : 0}%)</strong>
                          </div>
                        )}
                        {hasConfig && (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span>Potencial semanal:</span>
                              <strong style={{ color: 'var(--text-primary)' }}>{(perf.annualPotential / 52).toFixed(1)} ovos</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span>Potencial mensal:</span>
                              <strong style={{ color: 'var(--text-primary)' }}>{(perf.annualPotential / 12).toFixed(1)} ovos</strong>
                            </div>
                          </>
                        )}
                        {bird.ringNumber && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span>Anilha:</span>
                            <strong>{bird.ringNumber} {bird.ringColor && `(${bird.ringColor})`}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Collection Records */}
      <div className="filter-bar">
        <select className="form-input" style={{ width: 'auto', minWidth: 200 }} value={filterBird} onChange={e => setFilterBird(e.target.value)}>
          <option value="all">Todas as aves</option>
          {birds.map(b => <option key={b.id} value={b.id}>{getBirdLabel(b)}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => {
          setBatchDate(new Date().toISOString().slice(0, 10));
          setBatchEntries({});
          setBatchNotes('');
          setEditingId(null);
          setShowModal(true);
        }}>
          <Plus size={16} /> Nova Coleta
        </button>
      </div>

      {filteredCollections.length > 0 ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Registro de Coletas ({filteredCollections.length})</span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Ave / Raca</th>
                  <th>Ovos</th>
                  <th>Trincados</th>
                  <th>Bons</th>
                  <th>Obs</th>
                  <th style={{ width: 80, textAlign: 'center' }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {filteredCollections.map(c => {
                  const bird = birds.find(b => b.id === c.birdId);
                  return (
                    <tr key={c.id}>
                      <td>{formatDate(c.date)}</td>
                      <td>
                        <strong>{bird ? getBirdLabel(bird) : 'Ave removida'}</strong>
                        {bird?.ringNumber && (
                          <span style={{
                            marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 6,
                            background: bird.ringColor ? bird.ringColor + '20' : '#e2e8f0',
                            color: bird.ringColor || 'var(--text-muted)',
                            fontWeight: 600,
                          }}>
                            {bird.ringNumber}
                          </span>
                        )}
                      </td>
                      <td style={{ fontWeight: 600 }}>{c.quantity}</td>
                      <td style={{ color: (parseInt(c.cracked) || 0) > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                        {c.cracked || 0}
                      </td>
                      <td style={{ color: 'var(--success)', fontWeight: 600 }}>{(parseInt(c.quantity) || 0) - (parseInt(c.cracked) || 0)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.notes || '-'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                          <button className="btn-icon" title="Editar" onClick={() => handleEdit(c)}>
                            <Edit2 size={14} />
                          </button>
                          <button className="btn-icon" title="Excluir" onClick={() => handleDelete(c.id)} style={{ color: 'var(--danger)' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <Egg size={48} />
          <h3>Nenhuma coleta registrada</h3>
          <p>Registre a coleta diaria de ovos para acompanhar o desempenho do plantel</p>
        </div>
      )}

      {/* Add/Edit Collection Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={!editingId ? { maxWidth: 620 } : undefined}>
            {editingId ? (
              <>
                <h3 className="modal-title">Editar Coleta</h3>
                <form onSubmit={handleEditSubmit}>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Data *</label>
                      <input className="form-input" type="date" required value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Ave / Raca *</label>
                      <select className="form-input" required value={editForm.birdId} onChange={e => setEditForm({ ...editForm, birdId: e.target.value })}>
                        <option value="">Selecione a ave</option>
                        {birds.map(b => <option key={b.id} value={b.id}>{getBirdLabel(b)}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Quantidade de Ovos *</label>
                      <input className="form-input" type="number" min="0" required value={editForm.quantity} onChange={e => setEditForm({ ...editForm, quantity: e.target.value })} placeholder="0" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Ovos Trincados</label>
                      <input className="form-input" type="number" min="0" value={editForm.cracked} onChange={e => setEditForm({ ...editForm, cracked: e.target.value })} placeholder="0" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Observacoes</label>
                    <input className="form-input" type="text" value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Ex: Ovos para chocadeira, ovos para venda..." />
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                    <button type="submit" className="btn btn-primary">Salvar</button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <h3 className="modal-title">Nova Coleta de Ovos</h3>
                <form onSubmit={handleBatchSubmit}>
                  <div className="form-row" style={{ marginBottom: 16 }}>
                    <div className="form-group">
                      <label className="form-label">Data da Coleta *</label>
                      <input className="form-input" type="date" required value={batchDate} onChange={e => setBatchDate(e.target.value)} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, paddingBottom: 2 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        Total: <span style={{ color: 'var(--primary)', fontSize: 16 }}>{batchTotal}</span> ovos
                      </div>
                      {batchCrackedTotal > 0 && (
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>
                          {batchCrackedTotal} trincados
                        </div>
                      )}
                    </div>
                  </div>

                  {birds.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                      Nenhuma ave cadastrada. Cadastre aves na pagina do Plantel primeiro.
                    </div>
                  ) : (
                    <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                            <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>Ave / Raca</th>
                            <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, fontWeight: 600, width: 100 }}>Ovos</th>
                            <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, fontWeight: 600, width: 100 }}>Trincados</th>
                          </tr>
                        </thead>
                        <tbody>
                          {birds.map(bird => {
                            const entry = batchEntries[bird.id] || { quantity: '', cracked: '' };
                            const matrices = parseInt(bird.matrixCount) || 1;
                            return (
                              <tr key={bird.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '8px 12px' }}>
                                  <div style={{ fontWeight: 600, fontSize: 13 }}>{bird.species} - {bird.breed}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    {matrices} {matrices > 1 ? 'matrizes' : 'matriz'}
                                    {bird.ringNumber && (
                                      <span style={{
                                        marginLeft: 6, padding: '1px 5px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                                        background: bird.ringColor ? bird.ringColor + '30' : '#e2e8f0',
                                        color: bird.ringColor || 'var(--text-secondary)',
                                      }}>
                                        {bird.ringNumber}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                  <input
                                    className="form-input"
                                    type="number"
                                    min="0"
                                    value={entry.quantity}
                                    onChange={e => updateBatchEntry(bird.id, 'quantity', e.target.value)}
                                    placeholder="0"
                                    style={{ width: 70, textAlign: 'center', padding: '6px 4px', margin: '0 auto' }}
                                  />
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                  <input
                                    className="form-input"
                                    type="number"
                                    min="0"
                                    value={entry.cracked}
                                    onChange={e => updateBatchEntry(bird.id, 'cracked', e.target.value)}
                                    placeholder="0"
                                    style={{ width: 70, textAlign: 'center', padding: '6px 4px', margin: '0 auto' }}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label className="form-label">Observacoes</label>
                    <input className="form-input" type="text" value={batchNotes} onChange={e => setBatchNotes(e.target.value)} placeholder="Ex: Ovos para chocadeira, ovos para venda..." />
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                    <button type="submit" className="btn btn-primary" disabled={batchTotal === 0}>
                      <Egg size={14} /> Registrar {batchTotal > 0 ? `${batchTotal} ovos` : 'Coleta'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bird Config Modal (annual potential, ring, notes) */}
      {showBirdConfigModal && (
        <div className="modal-overlay" onClick={() => setShowBirdConfigModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Configurar Ave</h3>
            {(() => {
              const bird = birds.find(b => b.id === showBirdConfigModal);
              if (!bird) return null;
              return (
                <>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    {bird.species} - {bird.breed} ({parseInt(bird.matrixCount) || 1} matrizes)
                  </p>
                  <div className="form-group">
                    <label className="form-label">Potencial Anual de Ovos (por matriz) *</label>
                    <input className="form-input" type="number" min="0" value={birdConfigForm.annualEggPotential}
                      onChange={e => setBirdConfigForm({ ...birdConfigForm, annualEggPotential: e.target.value })}
                      placeholder="Ex: 180, 250, 300..."
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                      Quantidade media de ovos que a raca produz por ano (por ave). Ex: Ganso = 40, Galinha caipira = 180
                    </span>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Numero da Anilha</label>
                      <input className="form-input" type="text" value={birdConfigForm.ringNumber}
                        onChange={e => setBirdConfigForm({ ...birdConfigForm, ringNumber: e.target.value })}
                        placeholder="Ex: 001, A12..."
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Cor da Anilha</label>
                      <input className="form-input" type="text" value={birdConfigForm.ringColor}
                        onChange={e => setBirdConfigForm({ ...birdConfigForm, ringColor: e.target.value })}
                        placeholder="Ex: Azul, Vermelho..."
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Observacoes da Ave</label>
                    <input className="form-input" type="text" value={birdConfigForm.notes}
                      onChange={e => setBirdConfigForm({ ...birdConfigForm, notes: e.target.value })}
                      placeholder="Ex: Idade, origem, observacoes gerais..."
                    />
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowBirdConfigModal(null)}>Cancelar</button>
                    <button type="button" className="btn btn-primary" onClick={handleSaveBirdConfig}>
                      <Save size={14} /> Salvar
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
