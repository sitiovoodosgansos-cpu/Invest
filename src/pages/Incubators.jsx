import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { formatDate } from '../utils/helpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  Plus, Trash2, Edit2, Thermometer, TrendingUp, Calendar, Egg,
  ChevronDown, ChevronUp, Save, AlertTriangle, Baby, CheckCircle, X
} from 'lucide-react';
import Portal from '../components/Portal';

const MONTH_NAMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

// Status labels and colors
const BATCH_STATUS = {
  incubating: { label: 'Incubando', color: '#f59e0b', bg: '#fef3c7' },
  hatched: { label: 'Eclodida', color: '#10b981', bg: '#d1fae5' },
  cancelled: { label: 'Cancelada', color: '#ef4444', bg: '#fee2e2' },
};

export default function Incubators() {
  const {
    birds, incubators, incubatorBatches,
    addIncubator, updateIncubator, deleteIncubator,
    addIncubatorBatch, updateIncubatorBatch, deleteIncubatorBatch,
  } = useApp();

  const allIncubators = incubators || [];
  const allBatches = incubatorBatches || [];

  // Modals
  const [showIncubatorModal, setShowIncubatorModal] = useState(false);
  const [editingIncubator, setEditingIncubator] = useState(null);
  const [incubatorForm, setIncubatorForm] = useState({ name: '', capacity: '', notes: '' });

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const [batchForm, setBatchForm] = useState({ incubatorId: '', dateIn: '', notes: '' });
  const [batchEggs, setBatchEggs] = useState({});

  const [showHatchModal, setShowHatchModal] = useState(false);
  const [hatchBatchId, setHatchBatchId] = useState(null);
  const [hatchForm, setHatchForm] = useState({ dateHatch: '', hatchResults: {}, notes: '' });

  const [expandedIncubator, setExpandedIncubator] = useState(null);
  const [filterIncubator, setFilterIncubator] = useState('all');
  const [periodView, setPeriodView] = useState('month');

  const getBirdLabel = (bird) => `${bird.species} - ${bird.breed}`;

  // Period boundaries
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // Helper to sum losses from a batch
  const getBatchLosses = (b) => (parseInt(b.totalInfertil) || 0) + (parseInt(b.totalNaoDesenvolveu) || 0) + (parseInt(b.totalMorreuNoOvo) || 0);

  // Stats from hatched batches
  const hatchStats = useMemo(() => {
    const hatched = allBatches.filter(b => b.status === 'hatched' && b.dateHatch);
    const totalChicks = hatched.reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);
    const totalInfertil = hatched.reduce((s, b) => s + (parseInt(b.totalInfertil) || 0), 0);
    const totalNaoDesenvolveu = hatched.reduce((s, b) => s + (parseInt(b.totalNaoDesenvolveu) || 0), 0);
    const totalMorreuNoOvo = hatched.reduce((s, b) => s + (parseInt(b.totalMorreuNoOvo) || 0), 0);
    const totalLosses = totalInfertil + totalNaoDesenvolveu + totalMorreuNoOvo;
    const totalEggsSet = hatched.reduce((s, b) => s + (parseInt(b.totalEggs) || 0), 0);

    const weekChicks = hatched.filter(b => new Date(b.dateHatch) >= startOfWeek).reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);
    const monthChicks = hatched.filter(b => new Date(b.dateHatch) >= startOfMonth).reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);
    const yearChicks = hatched.filter(b => new Date(b.dateHatch) >= startOfYear).reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);

    const overallHatchRate = totalEggsSet > 0 ? ((totalChicks / totalEggsSet) * 100) : 0;

    return { totalChicks, totalInfertil, totalNaoDesenvolveu, totalMorreuNoOvo, totalLosses, totalEggsSet, weekChicks, monthChicks, yearChicks, overallHatchRate };
  }, [allBatches, startOfWeek.getTime(), startOfMonth.getTime(), startOfYear.getTime()]);

  // Active batches (still incubating)
  const activeBatches = useMemo(() => allBatches.filter(b => b.status === 'incubating'), [allBatches]);

  // Per-incubator stats
  const incubatorStats = useMemo(() => {
    const stats = {};
    allIncubators.forEach(inc => {
      const batches = allBatches.filter(b => b.incubatorId === inc.id);
      const hatchedBatches = batches.filter(b => b.status === 'hatched');
      const totalEggs = hatchedBatches.reduce((s, b) => s + (parseInt(b.totalEggs) || 0), 0);
      const totalHatched = hatchedBatches.reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);
      const totalLosses = hatchedBatches.reduce((s, b) => s + getBatchLosses(b), 0);
      const hatchRate = totalEggs > 0 ? ((totalHatched / totalEggs) * 100) : 0;
      const activeBatch = batches.filter(b => b.status === 'incubating');
      stats[inc.id] = { totalBatches: batches.length, hatchedBatches: hatchedBatches.length, totalEggs, totalHatched, totalLosses, hatchRate, activeBatch };
    });
    return stats;
  }, [allIncubators, allBatches]);

  // Monthly chick chart (last 6 months)
  const monthlyChartData = useMemo(() => {
    const months = [];
    const hatchedBatches = allBatches.filter(b => b.status === 'hatched' && b.dateHatch);
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
      const mBatches = hatchedBatches.filter(b => {
        const d = new Date(b.dateHatch);
        return d >= m && d <= mEnd;
      });
      const chicks = mBatches.reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);
      const infertil = mBatches.reduce((s, b) => s + (parseInt(b.totalInfertil) || 0), 0);
      const naoDesenv = mBatches.reduce((s, b) => s + (parseInt(b.totalNaoDesenvolveu) || 0), 0);
      const morreu = mBatches.reduce((s, b) => s + (parseInt(b.totalMorreuNoOvo) || 0), 0);
      months.push({
        period: MONTH_NAMES[m.getMonth()],
        nascidos: chicks,
        inferteis: infertil,
        naoDesenvolveu: naoDesenv,
        morreuNoOvo: morreu,
      });
    }
    return months;
  }, [allBatches]);

  // Weekly chick chart (last 8 weeks)
  const weeklyChartData = useMemo(() => {
    const weeks = [];
    const hatchedBatches = allBatches.filter(b => b.status === 'hatched' && b.dateHatch);
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay() - (i * 7));
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const wBatches = hatchedBatches.filter(b => {
        const d = new Date(b.dateHatch);
        return d >= weekStart && d < weekEnd;
      });
      const chicks = wBatches.reduce((s, b) => s + (parseInt(b.totalHatched) || 0), 0);
      const infertil = wBatches.reduce((s, b) => s + (parseInt(b.totalInfertil) || 0), 0);
      const naoDesenv = wBatches.reduce((s, b) => s + (parseInt(b.totalNaoDesenvolveu) || 0), 0);
      const morreu = wBatches.reduce((s, b) => s + (parseInt(b.totalMorreuNoOvo) || 0), 0);
      const getWeekNum = (date) => {
        const d = new Date(date);
        const start = new Date(d.getFullYear(), 0, 1);
        return Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
      };
      weeks.push({
        period: `S${getWeekNum(weekStart)}`,
        nascidos: chicks,
        inferteis: infertil,
        naoDesenvolveu: naoDesenv,
        morreuNoOvo: morreu,
      });
    }
    return weeks;
  }, [allBatches]);

  // Filtered batches for the table
  const filteredBatches = useMemo(() => {
    let list = [...allBatches];
    if (filterIncubator !== 'all') list = list.filter(b => b.incubatorId === filterIncubator);
    return list.sort((a, b) => new Date(b.dateIn) - new Date(a.dateIn));
  }, [allBatches, filterIncubator]);

  // Batch egg total helper
  const getBatchEggTotal = (eggs) => {
    if (!eggs) return 0;
    return Object.values(eggs).reduce((s, qty) => s + (parseInt(qty) || 0), 0);
  };

  // --- Handlers ---

  const handleSaveIncubator = (e) => {
    e.preventDefault();
    const data = {
      name: incubatorForm.name.trim(),
      capacity: parseInt(incubatorForm.capacity) || 0,
      notes: incubatorForm.notes.trim(),
    };
    if (editingIncubator) {
      updateIncubator(editingIncubator, data);
    } else {
      addIncubator(data);
    }
    setShowIncubatorModal(false);
    setEditingIncubator(null);
  };

  const handleEditIncubator = (inc) => {
    setIncubatorForm({ name: inc.name, capacity: String(inc.capacity || ''), notes: inc.notes || '' });
    setEditingIncubator(inc.id);
    setShowIncubatorModal(true);
  };

  const handleDeleteIncubator = (id) => {
    const batchCount = allBatches.filter(b => b.incubatorId === id).length;
    if (window.confirm(`Remover esta chocadeira${batchCount > 0 ? ` e suas ${batchCount} chocagens` : ''}?`)) {
      deleteIncubator(id);
    }
  };

  const handleSaveBatch = (e) => {
    e.preventDefault();
    const totalEggs = getBatchEggTotal(batchEggs);
    if (totalEggs === 0) return;
    const data = {
      incubatorId: batchForm.incubatorId,
      dateIn: batchForm.dateIn,
      eggs: batchEggs, // { birdId: quantity }
      totalEggs,
      notes: batchForm.notes.trim(),
      status: 'incubating',
      totalHatched: 0,
      totalInfertil: 0,
      totalNaoDesenvolveu: 0,
      totalMorreuNoOvo: 0,
      dateHatch: '',
      hatchResults: {},
    };
    if (editingBatch) {
      updateIncubatorBatch(editingBatch, { ...data, status: undefined }); // don't reset status on edit
      // Actually preserve existing status
      const existing = allBatches.find(b => b.id === editingBatch);
      updateIncubatorBatch(editingBatch, {
        incubatorId: batchForm.incubatorId,
        dateIn: batchForm.dateIn,
        eggs: batchEggs,
        totalEggs,
        notes: batchForm.notes.trim(),
      });
    } else {
      addIncubatorBatch(data);
    }
    setShowBatchModal(false);
    setEditingBatch(null);
  };

  const openNewBatch = (incubatorId) => {
    setBatchForm({ incubatorId: incubatorId || (allIncubators[0]?.id || ''), dateIn: new Date().toISOString().slice(0, 10), notes: '' });
    setBatchEggs({});
    setEditingBatch(null);
    setShowBatchModal(true);
  };

  const handleEditBatch = (batch) => {
    setBatchForm({ incubatorId: batch.incubatorId, dateIn: batch.dateIn, notes: batch.notes || '' });
    setBatchEggs(batch.eggs || {});
    setEditingBatch(batch.id);
    setShowBatchModal(true);
  };

  const handleDeleteBatch = (id) => {
    if (window.confirm('Remover esta chocagem?')) deleteIncubatorBatch(id);
  };

  const updateBatchEgg = (birdId, value) => {
    setBatchEggs(prev => ({ ...prev, [birdId]: value }));
  };

  const batchEggTotal = useMemo(() => getBatchEggTotal(batchEggs), [batchEggs]);

  // Hatch results
  const openHatchModal = (batch) => {
    const results = {};
    // Initialize with eggs that were placed
    if (batch.eggs) {
      Object.keys(batch.eggs).forEach(birdId => {
        const existing = batch.hatchResults?.[birdId];
        results[birdId] = {
          hatched: existing?.hatched ?? '',
          infertil: existing?.infertil ?? '',
          naoDesenvolveu: existing?.naoDesenvolveu ?? '',
          morreuNoOvo: existing?.morreuNoOvo ?? '',
        };
      });
    }
    setHatchBatchId(batch.id);
    setHatchForm({
      dateHatch: batch.dateHatch || new Date().toISOString().slice(0, 10),
      hatchResults: results,
      notes: batch.hatchNotes || '',
    });
    setShowHatchModal(true);
  };

  const updateHatchResult = (birdId, field, value) => {
    setHatchForm(prev => ({
      ...prev,
      hatchResults: {
        ...prev.hatchResults,
        [birdId]: { ...(prev.hatchResults[birdId] || { hatched: '', infertil: '', naoDesenvolveu: '', morreuNoOvo: '' }), [field]: value },
      },
    }));
  };

  const hatchTotals = useMemo(() => {
    const results = hatchForm.hatchResults || {};
    const hatched = Object.values(results).reduce((s, r) => s + (parseInt(r.hatched) || 0), 0);
    const infertil = Object.values(results).reduce((s, r) => s + (parseInt(r.infertil) || 0), 0);
    const naoDesenvolveu = Object.values(results).reduce((s, r) => s + (parseInt(r.naoDesenvolveu) || 0), 0);
    const morreuNoOvo = Object.values(results).reduce((s, r) => s + (parseInt(r.morreuNoOvo) || 0), 0);
    return { hatched, infertil, naoDesenvolveu, morreuNoOvo, totalLosses: infertil + naoDesenvolveu + morreuNoOvo };
  }, [hatchForm.hatchResults]);

  const handleSaveHatch = (e) => {
    e.preventDefault();
    const batch = allBatches.find(b => b.id === hatchBatchId);
    if (!batch) return;
    updateIncubatorBatch(hatchBatchId, {
      status: 'hatched',
      dateHatch: hatchForm.dateHatch,
      hatchResults: hatchForm.hatchResults,
      totalHatched: hatchTotals.hatched,
      totalInfertil: hatchTotals.infertil,
      totalNaoDesenvolveu: hatchTotals.naoDesenvolveu,
      totalMorreuNoOvo: hatchTotals.morreuNoOvo,
      hatchNotes: hatchForm.notes.trim(),
    });
    setShowHatchModal(false);
  };

  const getHatchRateColor = (rate) => {
    if (rate >= 70) return 'var(--success)';
    if (rate >= 50) return 'var(--warning)';
    if (rate > 0) return 'var(--danger)';
    return 'var(--text-muted)';
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Controle de Chocadeiras</h2>
        <p>Gerenciamento de chocadeiras, chocagens e eclosao de pintinhos</p>
      </div>

      {/* Summary Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#fef3c7', color: '#d97706' }}><Baby size={20} /></div>
          <div className="stat-label">Pintinhos Semana</div>
          <div className="stat-value">{hatchStats.weekChicks}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: '#dbeafe', color: '#2563eb' }}><Calendar size={20} /></div>
          <div className="stat-label">Pintinhos Mes</div>
          <div className="stat-value">{hatchStats.monthChicks}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon green"><TrendingUp size={20} /></div>
          <div className="stat-label">Pintinhos Ano</div>
          <div className="stat-value">{hatchStats.yearChicks}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon purple"><Thermometer size={20} /></div>
          <div className="stat-label">Taxa Eclosao Geral</div>
          <div className="stat-value" style={{ color: getHatchRateColor(hatchStats.overallHatchRate) }}>
            {hatchStats.overallHatchRate.toFixed(0)}%
          </div>
          {hatchStats.totalLosses > 0 && (
            <div className="stat-change" style={{ color: 'var(--danger)', fontSize: 11 }}>
              {hatchStats.totalLosses} perdas
            </div>
          )}
        </div>
      </div>

      {/* Charts */}
      {allBatches.some(b => b.status === 'hatched') && (
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Nascimentos Semanais</span>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="period" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="nascidos" name="Nascidos" fill="#10B981" stackId="a" />
                  <Bar dataKey="inferteis" name="Inferteis" fill="#94a3b8" stackId="a" />
                  <Bar dataKey="naoDesenvolveu" name="Nao Desenvolveu" fill="#f59e0b" stackId="a" />
                  <Bar dataKey="morreuNoOvo" name="Morreu no Ovo" fill="#EF4444" stackId="a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Nascimentos Mensais</span>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="period" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="nascidos" name="Nascidos" fill="#3B82F6" stackId="a" />
                  <Bar dataKey="inferteis" name="Inferteis" fill="#94a3b8" stackId="a" />
                  <Bar dataKey="naoDesenvolveu" name="Nao Desenvolveu" fill="#f59e0b" stackId="a" />
                  <Bar dataKey="morreuNoOvo" name="Morreu no Ovo" fill="#EF4444" stackId="a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Incubator Cards */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-title">Chocadeiras ({allIncubators.length})</span>
          <button className="btn btn-primary btn-sm" onClick={() => {
            setIncubatorForm({ name: `Chocadeira ${allIncubators.length + 1}`, capacity: '', notes: '' });
            setEditingIncubator(null);
            setShowIncubatorModal(true);
          }}>
            <Plus size={14} /> Nova Chocadeira
          </button>
        </div>

        {allIncubators.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Thermometer size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>Nenhuma chocadeira cadastrada</p>
            <p style={{ fontSize: 12 }}>Adicione suas chocadeiras para comecar a registrar chocagens</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, padding: 16 }}>
            {allIncubators.map(inc => {
              const stats = incubatorStats[inc.id] || {};
              const isExpanded = expandedIncubator === inc.id;
              const hasActive = stats.activeBatch?.length > 0;

              return (
                <div key={inc.id} style={{
                  border: `1px solid ${hasActive ? '#f59e0b' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: 16,
                  background: 'var(--bg-card)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: hasActive ? '#fef3c7' : 'var(--primary-bg)',
                        color: hasActive ? '#d97706' : 'var(--primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Thermometer size={18} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{inc.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {inc.capacity > 0 ? `Capacidade: ${inc.capacity} ovos` : 'Sem capacidade definida'}
                          {hasActive && (
                            <span style={{
                              marginLeft: 6, padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                              background: '#fef3c7', color: '#d97706',
                            }}>
                              {stats.activeBatch.length} ativa{stats.activeBatch.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" title="Nova chocagem" onClick={() => openNewBatch(inc.id)} style={{ color: 'var(--primary)' }}>
                        <Plus size={14} />
                      </button>
                      <button className="btn-icon" title="Editar" onClick={() => handleEditIncubator(inc)}>
                        <Edit2 size={14} />
                      </button>
                      <button className="btn-icon" onClick={() => setExpandedIncubator(isExpanded ? null : inc.id)}>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Chocagens</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{stats.totalBatches || 0}</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Nascidos</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{stats.totalHatched || 0}</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Taxa</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: getHatchRateColor(stats.hatchRate || 0) }}>
                        {(stats.hatchRate || 0).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  {stats.totalLosses > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <AlertTriangle size={12} /> {stats.totalLosses} perdas no total
                    </div>
                  )}

                  {/* Expanded: show batches for this incubator */}
                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      {inc.notes && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontStyle: 'italic' }}>{inc.notes}</div>
                      )}
                      {(() => {
                        const incBatches = allBatches.filter(b => b.incubatorId === inc.id).sort((a, b) => new Date(b.dateIn) - new Date(a.dateIn));
                        if (incBatches.length === 0) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma chocagem registrada</div>;
                        return incBatches.map((batch, batchIdx) => {
                          const st = BATCH_STATUS[batch.status] || BATCH_STATUS.incubating;
                          const hatchRate = (parseInt(batch.totalEggs) || 0) > 0
                            ? ((parseInt(batch.totalHatched) || 0) / (parseInt(batch.totalEggs) || 1) * 100) : 0;
                          const batchNumber = incBatches.length - batchIdx;
                          return (
                            <div key={batch.id} style={{
                              padding: 10, marginBottom: 8, borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border)', background: 'var(--bg-primary)',
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{
                                    padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                                    background: '#e0e7ff', color: '#3730a3',
                                  }}>Lote #{batchNumber}</span>
                                  <span style={{
                                    padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                                    background: st.bg, color: st.color,
                                  }}>{st.label}</span>
                                  <span style={{ fontSize: 12, fontWeight: 600 }}>Entrada: {formatDate(batch.dateIn)}</span>
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {batch.status === 'incubating' && (
                                    <button className="btn-icon" title="Registrar eclosao" onClick={() => openHatchModal(batch)} style={{ color: 'var(--success)' }}>
                                      <CheckCircle size={14} />
                                    </button>
                                  )}
                                  <button className="btn-icon" title="Editar" onClick={() => handleEditBatch(batch)}>
                                    <Edit2 size={12} />
                                  </button>
                                  <button className="btn-icon" title="Excluir" onClick={() => handleDeleteBatch(batch.id)} style={{ color: 'var(--danger)' }}>
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                <span>{batch.totalEggs} ovos</span>
                                {batch.status === 'hatched' && (
                                  <>
                                    <span style={{ margin: '0 6px' }}>|</span>
                                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>{batch.totalHatched} nascidos</span>
                                    <span style={{ margin: '0 6px' }}>|</span>
                                    <span style={{ fontWeight: 600, color: getHatchRateColor(hatchRate) }}>{hatchRate.toFixed(0)}% eclosao</span>
                                    {getBatchLosses(batch) > 0 && (
                                      <>
                                        <span style={{ margin: '0 6px' }}>|</span>
                                        <span style={{ color: 'var(--text-muted)' }}>
                                          {(parseInt(batch.totalInfertil) || 0) > 0 && <span>{batch.totalInfertil} inf. </span>}
                                          {(parseInt(batch.totalNaoDesenvolveu) || 0) > 0 && <span>{batch.totalNaoDesenvolveu} n/desenv. </span>}
                                          {(parseInt(batch.totalMorreuNoOvo) || 0) > 0 && <span style={{ color: 'var(--danger)' }}>{batch.totalMorreuNoOvo} morreu</span>}
                                        </span>
                                      </>
                                    )}
                                  </>
                                )}
                              </div>
                              {/* Show eggs per bird */}
                              {batch.eggs && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                  {Object.entries(batch.eggs).filter(([, q]) => (parseInt(q) || 0) > 0).map(([birdId, qty]) => {
                                    const bird = birds.find(b => b.id === birdId);
                                    const hatchResult = batch.hatchResults?.[birdId];
                                    return (
                                      <span key={birdId} style={{ marginRight: 10 }}>
                                        {bird ? getBirdLabel(bird) : 'Ave removida'}: {qty} ovos
                                        {hatchResult && (parseInt(hatchResult.hatched) || 0) > 0 && (
                                          <span style={{ color: 'var(--success)' }}> ({hatchResult.hatched} nasc.)</span>
                                        )}
                                        {hatchResult && (parseInt(hatchResult.infertil) || 0) > 0 && (
                                          <span style={{ color: 'var(--text-muted)' }}> ({hatchResult.infertil} inf.)</span>
                                        )}
                                        {hatchResult && (parseInt(hatchResult.naoDesenvolveu) || 0) > 0 && (
                                          <span style={{ color: '#f59e0b' }}> ({hatchResult.naoDesenvolveu} n/des.)</span>
                                        )}
                                        {hatchResult && (parseInt(hatchResult.morreuNoOvo) || 0) > 0 && (
                                          <span style={{ color: 'var(--danger)' }}> ({hatchResult.morreuNoOvo} morreu)</span>
                                        )}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                      <div style={{ marginTop: 4 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleDeleteIncubator(inc.id)} style={{ color: 'var(--danger)', fontSize: 11 }}>
                          <Trash2 size={12} /> Excluir Chocadeira
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Batch Records Table */}
      <div className="filter-bar">
        <select className="form-input" style={{ width: 'auto', minWidth: 200 }} value={filterIncubator} onChange={e => setFilterIncubator(e.target.value)}>
          <option value="all">Todas as chocadeiras</option>
          {allIncubators.map(inc => <option key={inc.id} value={inc.id}>{inc.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => openNewBatch()} disabled={allIncubators.length === 0}>
          <Plus size={16} /> Nova Chocagem
        </button>
      </div>

      {filteredBatches.length > 0 ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Registro de Chocagens ({filteredBatches.length})</span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Chocadeira</th>
                  <th>Data Entrada</th>
                  <th>Ovos</th>
                  <th>Status</th>
                  <th>Nascidos</th>
                  <th>Inferteis</th>
                  <th>N/Desenv.</th>
                  <th>Morreu</th>
                  <th>Taxa</th>
                  <th style={{ width: 100, textAlign: 'center' }}>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map((batch, idx) => {
                  const inc = allIncubators.find(i => i.id === batch.incubatorId);
                  const st = BATCH_STATUS[batch.status] || BATCH_STATUS.incubating;
                  const hatchRate = (parseInt(batch.totalEggs) || 0) > 0
                    ? ((parseInt(batch.totalHatched) || 0) / (parseInt(batch.totalEggs) || 1) * 100) : 0;
                  // Calculate batch number within its incubator
                  const incBatches = allBatches.filter(b => b.incubatorId === batch.incubatorId).sort((a, b) => new Date(a.dateIn) - new Date(b.dateIn));
                  const batchNum = incBatches.findIndex(b => b.id === batch.id) + 1;
                  return (
                    <tr key={batch.id}>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: '#e0e7ff', color: '#3730a3' }}>
                          #{batchNum}
                        </span>
                      </td>
                      <td><strong>{inc ? inc.name : 'Removida'}</strong></td>
                      <td>{formatDate(batch.dateIn)}</td>
                      <td style={{ fontWeight: 600 }}>{batch.totalEggs}</td>
                      <td>
                        <span style={{
                          padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: st.bg, color: st.color,
                        }}>{st.label}</span>
                      </td>
                      <td style={{ fontWeight: 600, color: batch.status === 'hatched' ? 'var(--success)' : 'var(--text-muted)' }}>
                        {batch.status === 'hatched' ? batch.totalHatched : '-'}
                      </td>
                      <td style={{ fontWeight: 600, color: (parseInt(batch.totalInfertil) || 0) > 0 ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                        {batch.status === 'hatched' ? (batch.totalInfertil || 0) : '-'}
                      </td>
                      <td style={{ fontWeight: 600, color: (parseInt(batch.totalNaoDesenvolveu) || 0) > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                        {batch.status === 'hatched' ? (batch.totalNaoDesenvolveu || 0) : '-'}
                      </td>
                      <td style={{ fontWeight: 600, color: (parseInt(batch.totalMorreuNoOvo) || 0) > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                        {batch.status === 'hatched' ? (batch.totalMorreuNoOvo || 0) : '-'}
                      </td>
                      <td style={{ fontWeight: 600, color: batch.status === 'hatched' ? getHatchRateColor(hatchRate) : 'var(--text-muted)' }}>
                        {batch.status === 'hatched' ? `${hatchRate.toFixed(0)}%` : '-'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                          {batch.status === 'incubating' && (
                            <button className="btn-icon" title="Registrar eclosao" onClick={() => openHatchModal(batch)} style={{ color: 'var(--success)' }}>
                              <CheckCircle size={14} />
                            </button>
                          )}
                          <button className="btn-icon" title="Editar" onClick={() => handleEditBatch(batch)}>
                            <Edit2 size={14} />
                          </button>
                          <button className="btn-icon" title="Excluir" onClick={() => handleDeleteBatch(batch.id)} style={{ color: 'var(--danger)' }}>
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
          <Thermometer size={48} />
          <h3>Nenhuma chocagem registrada</h3>
          <p>Cadastre uma chocadeira e registre chocagens para acompanhar os nascimentos</p>
        </div>
      )}

      {/* Incubator Modal (add/edit) */}
      {showIncubatorModal && (
        <Portal><div className="modal-overlay" onClick={() => setShowIncubatorModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{editingIncubator ? 'Editar Chocadeira' : 'Nova Chocadeira'}</h3>
            <form onSubmit={handleSaveIncubator}>
              <div className="form-group">
                <label className="form-label">Nome *</label>
                <input className="form-input" type="text" required value={incubatorForm.name}
                  onChange={e => setIncubatorForm({ ...incubatorForm, name: e.target.value })}
                  placeholder="Ex: Chocadeira 1"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Capacidade (ovos)</label>
                <input className="form-input" type="number" min="0" value={incubatorForm.capacity}
                  onChange={e => setIncubatorForm({ ...incubatorForm, capacity: e.target.value })}
                  placeholder="Ex: 100, 200..."
                />
              </div>
              <div className="form-group">
                <label className="form-label">Observacoes</label>
                <input className="form-input" type="text" value={incubatorForm.notes}
                  onChange={e => setIncubatorForm({ ...incubatorForm, notes: e.target.value })}
                  placeholder="Ex: Marca, modelo, localizacao..."
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowIncubatorModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">
                  <Save size={14} /> {editingIncubator ? 'Salvar' : 'Criar Chocadeira'}
                </button>
              </div>
            </form>
          </div>
        </div></Portal>
      )}

      {/* Batch Modal (add eggs to incubator) */}
      {showBatchModal && (
        <Portal><div className="modal-overlay" onClick={() => setShowBatchModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <h3 className="modal-title">{editingBatch ? 'Editar Chocagem' : 'Nova Chocagem'}</h3>
            <form onSubmit={handleSaveBatch}>
              <div className="form-row" style={{ marginBottom: 12 }}>
                <div className="form-group">
                  <label className="form-label">Chocadeira *</label>
                  <select className="form-input" required value={batchForm.incubatorId}
                    onChange={e => setBatchForm({ ...batchForm, incubatorId: e.target.value })}>
                    <option value="">Selecione</option>
                    {allIncubators.map(inc => <option key={inc.id} value={inc.id}>{inc.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Data de Entrada *</label>
                  <input className="form-input" type="date" required value={batchForm.dateIn}
                    onChange={e => setBatchForm({ ...batchForm, dateIn: e.target.value })} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label className="form-label" style={{ margin: 0 }}>Ovos por Ave</label>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Total: <span style={{ color: 'var(--primary)', fontSize: 16 }}>{batchEggTotal}</span> ovos
                </div>
              </div>

              {birds.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Nenhuma ave cadastrada. Cadastre aves na pagina do Plantel primeiro.
                </div>
              ) : (
                <div style={{ maxHeight: 350, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>Ave / Raca</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, fontWeight: 600, width: 100 }}>Ovos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {birds.map(bird => {
                        const qty = batchEggs[bird.id] || '';
                        const matrices = parseInt(bird.matrixCount) || 1;
                        return (
                          <tr key={bird.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px 12px' }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{bird.species} - {bird.breed}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {matrices} {matrices > 1 ? 'matrizes' : 'matriz'}
                              </div>
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              <input className="form-input" type="number" min="0" value={qty}
                                onChange={e => updateBatchEgg(bird.id, e.target.value)}
                                placeholder="0" style={{ width: 70, textAlign: 'center', padding: '6px 4px', margin: '0 auto' }}
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
                <input className="form-input" type="text" value={batchForm.notes}
                  onChange={e => setBatchForm({ ...batchForm, notes: e.target.value })}
                  placeholder="Ex: Ovos selecionados, temperatura ajustada..."
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowBatchModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={batchEggTotal === 0}>
                  <Egg size={14} /> {editingBatch ? 'Salvar' : `Registrar ${batchEggTotal} ovos`}
                </button>
              </div>
            </form>
          </div>
        </div></Portal>
      )}

      {/* Hatch Results Modal */}
      {showHatchModal && (() => {
        const batch = allBatches.find(b => b.id === hatchBatchId);
        if (!batch) return null;
        return (
          <Portal><div className="modal-overlay" onClick={() => setShowHatchModal(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 780 }}>
              <h3 className="modal-title">Registrar Eclosao</h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {allIncubators.find(i => i.id === batch.incubatorId)?.name || 'Chocadeira'} - Entrada: {formatDate(batch.dateIn)} - {batch.totalEggs} ovos
              </p>

              <form onSubmit={handleSaveHatch}>
                <div className="form-row" style={{ marginBottom: 12 }}>
                  <div className="form-group">
                    <label className="form-label">Data da Eclosao *</label>
                    <input className="form-input" type="date" required value={hatchForm.dateHatch}
                      onChange={e => setHatchForm({ ...hatchForm, dateHatch: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, paddingBottom: 2 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      Nascidos: <span style={{ color: 'var(--success)', fontSize: 16 }}>{hatchTotals.hatched}</span>
                    </div>
                    {hatchTotals.totalLosses > 0 && (
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>
                        {hatchTotals.totalLosses} perdas
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Taxa: {batch.totalEggs > 0 ? ((hatchTotals.hatched / batch.totalEggs) * 100).toFixed(0) : 0}%
                    </div>
                  </div>
                </div>

                <div style={{ maxHeight: 350, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>Ave / Raca</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, fontWeight: 600, width: 70 }}>Ovos</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, fontWeight: 600, width: 90 }}>Nascidos</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, width: 75 }}>Infertil</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, width: 75 }}>N/Desenv.</th>
                        <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, width: 75 }}>Morreu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(batch.eggs || {}).filter(([, q]) => (parseInt(q) || 0) > 0).map(([birdId, eggQty]) => {
                        const bird = birds.find(b => b.id === birdId);
                        const result = hatchForm.hatchResults[birdId] || { hatched: '', infertil: '', naoDesenvolveu: '', morreuNoOvo: '' };
                        return (
                          <tr key={birdId} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '8px 12px' }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{bird ? getBirdLabel(bird) : 'Ave removida'}</div>
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: 'var(--text-secondary)' }}>
                              {eggQty}
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              <input className="form-input" type="number" min="0" max={eggQty}
                                value={result.hatched}
                                onChange={e => updateHatchResult(birdId, 'hatched', e.target.value)}
                                placeholder="0" style={{ width: 60, textAlign: 'center', padding: '6px 4px', margin: '0 auto' }}
                              />
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              <input className="form-input" type="number" min="0"
                                value={result.infertil}
                                onChange={e => updateHatchResult(birdId, 'infertil', e.target.value)}
                                placeholder="0" style={{ width: 55, textAlign: 'center', padding: '6px 2px', margin: '0 auto' }}
                              />
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              <input className="form-input" type="number" min="0"
                                value={result.naoDesenvolveu}
                                onChange={e => updateHatchResult(birdId, 'naoDesenvolveu', e.target.value)}
                                placeholder="0" style={{ width: 55, textAlign: 'center', padding: '6px 2px', margin: '0 auto' }}
                              />
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              <input className="form-input" type="number" min="0"
                                value={result.morreuNoOvo}
                                onChange={e => updateHatchResult(birdId, 'morreuNoOvo', e.target.value)}
                                placeholder="0" style={{ width: 60, textAlign: 'center', padding: '6px 4px', margin: '0 auto' }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="form-group" style={{ marginTop: 12 }}>
                  <label className="form-label">Observacoes da Eclosao</label>
                  <input className="form-input" type="text" value={hatchForm.notes}
                    onChange={e => setHatchForm({ ...hatchForm, notes: e.target.value })}
                    placeholder="Ex: Boa eclosao, temperatura estavel..."
                  />
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowHatchModal(false)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary">
                    <CheckCircle size={14} /> Registrar Eclosao
                  </button>
                </div>
              </form>
            </div>
          </div></Portal>
        );
      })()}
    </div>
  );
}
