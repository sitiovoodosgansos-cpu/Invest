import React, { useState, useMemo } from 'react';
import { useApp, BIRD_SPECIES } from '../context/AppContext';
import { formatDate } from '../utils/helpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  AreaChart, Area
} from 'recharts';
import {
  Plus, Trash2, Edit2, Egg, TrendingUp, AlertTriangle, Calendar,
  ChevronDown, ChevronUp, Target, Save, X, ChevronLeft, ChevronRight,
  Search, ArrowUpAZ, ArrowDownAZ, Heart, HeartOff, Link, Copy, RefreshCw, Trash
} from 'lucide-react';
import Portal from '../components/Portal';

const MONTH_NAMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

const MONTH_NAMES_FULL = [
  'Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

const BIRD_STATUS = {
  active: { label: 'Ativa', color: '#10B981', bg: '#d1fae5' },
  sick: { label: 'Doente', color: '#F59E0B', bg: '#fef3c7' },
  broody: { label: 'Choca', color: '#8B5CF6', bg: '#ede9fe' },
  dead: { label: 'Morta', color: '#EF4444', bg: '#fee2e2' },
};

function getWeekNumber(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = d - start;
  return Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
}

// Get or initialize individuals array for a bird
function getIndividuals(bird) {
  if (bird.individuals && bird.individuals.length > 0) return bird.individuals;
  const count = parseInt(bird.matrixCount) || 1;
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    ringNumber: '',
    status: 'active',
    notes: '',
  }));
}

function getActiveBirdCount(bird) {
  const individuals = getIndividuals(bird);
  return individuals.filter(i => i.status === 'active').length;
}

export default function EggCollection() {
  const {
    birds, eggCollections, customSpecies,
    addEggCollection, updateEggCollection, deleteEggCollection,
    updateBird,
    employeeToken, generateEmployeeToken, revokeEmployeeToken,
    saveError, forceSync,
  } = useApp();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [chartPeriod, setChartPeriod] = useState('weekly');
  const [expandedBird, setExpandedBird] = useState(null);
  const [showBirdConfigModal, setShowBirdConfigModal] = useState(null);
  const [birdConfigForm, setBirdConfigForm] = useState({ annualEggPotential: '', notes: '', individuals: [] });
  const [batchDate, setBatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [batchEntries, setBatchEntries] = useState({});
  const [batchNotes, setBatchNotes] = useState('');
  const [editForm, setEditForm] = useState({ date: '', birdId: '', quantity: '', cracked: '0', notes: '' });
  const [successMsg, setSuccessMsg] = useState('');
  // Calendar state
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  // Search/sort for bird performance
  const [birdSearch, setBirdSearch] = useState('');
  const [birdSort, setBirdSort] = useState('alpha'); // alpha | eggs
  const [showEmployeeLink, setShowEmployeeLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const allCollections = eggCollections || [];

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

  const getBirdLabel = (bird) => `${bird.species} - ${bird.breed}`;

  // Period calculations
  const now = new Date();
  const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const startOfWeekStr = toDateStr(startOfWeek);
  const startOfMonthStr = toDateStr(startOfMonth);
  const startOfYearStr = toDateStr(startOfYear);

  const weekTotal = useMemo(() =>
    allCollections.filter(c => c.date >= startOfWeekStr).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0),
    [allCollections, startOfWeekStr]
  );
  const weekCracked = useMemo(() =>
    allCollections.filter(c => c.date >= startOfWeekStr).reduce((s, c) => s + (parseInt(c.cracked) || 0), 0),
    [allCollections, startOfWeekStr]
  );
  const monthTotal = useMemo(() =>
    allCollections.filter(c => c.date >= startOfMonthStr).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0),
    [allCollections, startOfMonthStr]
  );
  const monthCracked = useMemo(() =>
    allCollections.filter(c => c.date >= startOfMonthStr).reduce((s, c) => s + (parseInt(c.cracked) || 0), 0),
    [allCollections, startOfMonthStr]
  );
  const yearTotal = useMemo(() =>
    allCollections.filter(c => c.date >= startOfYearStr).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0),
    [allCollections, startOfYearStr]
  );
  const yearCracked = useMemo(() =>
    allCollections.filter(c => c.date >= startOfYearStr).reduce((s, c) => s + (parseInt(c.cracked) || 0), 0),
    [allCollections, startOfYearStr]
  );

  const dayOfMonth = now.getDate();
  const dailyAvg = dayOfMonth > 0 ? (monthTotal / dayOfMonth).toFixed(1) : 0;

  // Bird performance - uses active bird count for potential calculation
  const birdPerformance = useMemo(() => {
    const perf = {};
    birds.forEach(bird => {
      const birdCollections = allCollections.filter(c => c.birdId === bird.id);
      const totalEggs = birdCollections.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      const totalCracked = birdCollections.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
      const weekEggs = birdCollections.filter(c => c.date >= startOfWeekStr).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      const monthEggs = birdCollections.filter(c => c.date >= startOfMonthStr).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      const yearEggs = birdCollections.filter(c => c.date >= startOfYearStr).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);

      const annualPotential = parseInt(bird.annualEggPotential) || 0;
      const totalBirds = parseInt(bird.matrixCount) || 1;
      const activeBirds = getActiveBirdCount(bird);
      // Performance based on ACTIVE birds only
      const activeAnnualPotential = annualPotential * activeBirds;

      let weekPerf = 0, monthPerf = 0, yearPerf = 0;
      if (activeAnnualPotential > 0) {
        weekPerf = ((weekEggs / (activeAnnualPotential / 52)) * 100);
        monthPerf = ((monthEggs / (activeAnnualPotential / 12)) * 100);
        yearPerf = ((yearEggs / activeAnnualPotential) * 100);
      }

      perf[bird.id] = {
        bird, totalEggs, totalCracked, weekEggs, monthEggs, yearEggs,
        annualPotential: activeAnnualPotential,
        totalBirds,
        activeBirds,
        weekPerf: Math.min(weekPerf, 999),
        monthPerf: Math.min(monthPerf, 999),
        yearPerf: Math.min(yearPerf, 999),
        collectionCount: birdCollections.length,
      };
    });
    return perf;
  }, [birds, allCollections, startOfWeekStr, startOfMonthStr, startOfYearStr]);

  // Filtered & sorted birds for cards
  const filteredBirds = useMemo(() => {
    let list = [...birds];
    if (birdSearch.trim()) {
      const q = birdSearch.toLowerCase();
      list = list.filter(b => `${b.species} ${b.breed}`.toLowerCase().includes(q));
    }
    if (birdSort === 'alpha') {
      list.sort((a, b) => `${a.species} ${a.breed}`.localeCompare(`${b.species} ${b.breed}`));
    } else {
      list.sort((a, b) => {
        const pa = birdPerformance[a.id]?.monthEggs || 0;
        const pb = birdPerformance[b.id]?.monthEggs || 0;
        return pb - pa;
      });
    }
    return list;
  }, [birds, birdSearch, birdSort, birdPerformance]);

  // ===== EVOLUTION CHART DATA =====
  const evolutionData = useMemo(() => {
    const data = [];
    if (chartPeriod === 'daily') {
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const dayCollections = allCollections.filter(c => c.date === key);
        const total = dayCollections.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
        const cracked = dayCollections.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
        data.push({ period: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, bons: total - cracked, trincados: cracked, total });
      }
    } else if (chartPeriod === 'weekly') {
      for (let i = 11; i >= 0; i--) {
        const ws = new Date(now);
        ws.setDate(now.getDate() - now.getDay() - (i * 7));
        ws.setHours(0, 0, 0, 0);
        const we = new Date(ws);
        we.setDate(ws.getDate() + 7);
        const wc = allCollections.filter(c => { const d = new Date(c.date); return d >= ws && d < we; });
        const total = wc.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
        const cracked = wc.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
        data.push({ period: `S${getWeekNumber(ws)}`, bons: total - cracked, trincados: cracked, total });
      }
    } else if (chartPeriod === 'monthly') {
      for (let i = 11; i >= 0; i--) {
        const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
        const mc = allCollections.filter(c => { const d = new Date(c.date); return d >= m && d <= mEnd; });
        const total = mc.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
        const cracked = mc.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
        data.push({ period: `${MONTH_NAMES[m.getMonth()]}/${String(m.getFullYear()).slice(2)}`, bons: total - cracked, trincados: cracked, total });
      }
    } else if (chartPeriod === 'yearly') {
      const years = new Set(allCollections.map(c => new Date(c.date).getFullYear()));
      years.add(now.getFullYear());
      const sorted = [...years].sort();
      for (const year of sorted) {
        const yc = allCollections.filter(c => new Date(c.date).getFullYear() === year);
        const total = yc.reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
        const cracked = yc.reduce((s, c) => s + (parseInt(c.cracked) || 0), 0);
        data.push({ period: String(year), bons: total - cracked, trincados: cracked, total });
      }
    }
    return data;
  }, [allCollections, chartPeriod]);

  // ===== TOP 10 BIRDS CHART =====
  const top10Data = useMemo(() => {
    return birds.map(bird => {
      const birdCols = allCollections.filter(c => c.birdId === bird.id);
      let eggs = 0;
      if (chartPeriod === 'daily') {
        const today = toDateStr(now);
        eggs = birdCols.filter(c => c.date === today).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      } else if (chartPeriod === 'weekly') {
        eggs = birdCols.filter(c => c.date >= startOfWeekStr).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      } else if (chartPeriod === 'monthly') {
        eggs = birdCols.filter(c => c.date >= startOfMonthStr).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      } else {
        eggs = birdCols.filter(c => c.date >= startOfYearStr).reduce((s, c) => s + (parseInt(c.quantity) || 0), 0);
      }
      return { name: bird.breed, eggs };
    }).filter(b => b.eggs > 0).sort((a, b) => b.eggs - a.eggs).slice(0, 10);
  }, [birds, allCollections, chartPeriod, startOfWeekStr, startOfMonthStr, startOfYearStr]);

  // ===== CALENDAR DATA =====
  const calendarYear = calendarDate.getFullYear();
  const calendarMonth = calendarDate.getMonth();

  const calendarDaysData = useMemo(() => {
    const map = {};
    const prefix = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}`;
    allCollections.forEach(c => {
      if (c.date && c.date.startsWith(prefix)) {
        const day = parseInt(c.date.slice(8, 10));
        if (!map[day]) map[day] = { total: 0, cracked: 0, collections: [] };
        map[day].total += parseInt(c.quantity) || 0;
        map[day].cracked += parseInt(c.cracked) || 0;
        map[day].collections.push(c);
      }
    });
    return map;
  }, [allCollections, calendarYear, calendarMonth]);

  const calendarGrid = useMemo(() => {
    const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const weeks = [];
    let week = new Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      week.push(d);
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }
    return weeks;
  }, [calendarYear, calendarMonth]);

  const selectedDayCollections = useMemo(() => {
    if (!selectedDay) return [];
    const key = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
    return allCollections.filter(c => c.date === key).sort((a, b) => (a.birdId || '').localeCompare(b.birdId || ''));
  }, [selectedDay, allCollections, calendarYear, calendarMonth]);

  const isToday = (day) => day === now.getDate() && calendarMonth === now.getMonth() && calendarYear === now.getFullYear();
  const navigateMonth = (delta) => { setCalendarDate(new Date(calendarYear, calendarMonth + delta, 1)); setSelectedDay(null); };
  const maxDayEggs = useMemo(() => Math.max(1, ...Object.values(calendarDaysData).map(d => d.total)), [calendarDaysData]);

  // ===== HANDLERS =====
  const handleBatchSubmit = (e) => {
    e.preventDefault();
    const entries = Object.entries(batchEntries).filter(([, v]) => (parseInt(v.quantity) || 0) > 0);
    if (entries.length === 0) return;
    const totalEggs = entries.reduce((s, [, v]) => s + (parseInt(v.quantity) || 0), 0);
    entries.forEach(([birdId, entry]) => {
      addEggCollection({ date: batchDate, birdId, quantity: parseInt(entry.quantity) || 0, cracked: parseInt(entry.cracked) || 0, notes: batchNotes.trim() });
    });
    // Extra safety: force a Firestore sync so the data is definitely persisted,
    // not just queued in the auto-save debounce window. Without this, navigating
    // away or reloading quickly after saving could drop the write.
    setTimeout(() => { try { forceSync(); } catch {} }, 100);
    setBatchEntries({}); setBatchNotes(''); setBatchDate(new Date().toISOString().slice(0, 10)); setShowModal(false);
    setSuccessMsg(`${entries.length} coleta(s) registrada(s) — ${totalEggs} ovos`);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (!editForm.birdId || !editForm.quantity) return;
    updateEggCollection(editingId, { date: editForm.date, birdId: editForm.birdId, quantity: parseInt(editForm.quantity) || 0, cracked: parseInt(editForm.cracked) || 0, notes: editForm.notes.trim() });
    setTimeout(() => { try { forceSync(); } catch {} }, 100);
    setEditingId(null); setShowModal(false);
    setSuccessMsg('Coleta atualizada');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleEdit = (collection) => {
    setEditForm({ date: collection.date, birdId: collection.birdId, quantity: String(collection.quantity), cracked: String(collection.cracked || 0), notes: collection.notes || '' });
    setEditingId(collection.id); setShowModal(true);
  };

  const updateBatchEntry = (birdId, field, value) => {
    setBatchEntries(prev => ({ ...prev, [birdId]: { ...(prev[birdId] || { quantity: '', cracked: '' }), [field]: value } }));
  };

  const batchTotal = useMemo(() => Object.values(batchEntries).reduce((s, e) => s + (parseInt(e.quantity) || 0), 0), [batchEntries]);
  const batchCrackedTotal = useMemo(() => Object.values(batchEntries).reduce((s, e) => s + (parseInt(e.cracked) || 0), 0), [batchEntries]);

  const handleDelete = (id) => { if (window.confirm('Remover esta coleta?')) deleteEggCollection(id); };

  const handleBirdConfig = (bird) => {
    const individuals = getIndividuals(bird);
    setBirdConfigForm({
      annualEggPotential: bird.annualEggPotential || '',
      notes: bird.birdNotes || '',
      individuals: individuals.map(ind => ({ ...ind })),
    });
    setShowBirdConfigModal(bird.id);
  };

  const handleSaveBirdConfig = () => {
    const individuals = birdConfigForm.individuals.map((ind, i) => ({
      id: ind.id || String(i + 1),
      ringNumber: (ind.ringNumber || '').trim(),
      status: ind.status || 'active',
      notes: (ind.notes || '').trim(),
    }));
    updateBird(showBirdConfigModal, {
      annualEggPotential: birdConfigForm.annualEggPotential,
      birdNotes: birdConfigForm.notes,
      individuals,
    });
    setShowBirdConfigModal(null);
  };

  const updateIndividual = (idx, field, value) => {
    setBirdConfigForm(prev => {
      const updated = [...prev.individuals];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, individuals: updated };
    });
  };

  const addIndividual = () => {
    setBirdConfigForm(prev => ({
      ...prev,
      individuals: [...prev.individuals, { id: String(Date.now()), ringNumber: '', status: 'active', notes: '' }],
    }));
  };

  const removeIndividual = (idx) => {
    setBirdConfigForm(prev => ({
      ...prev,
      individuals: prev.individuals.filter((_, i) => i !== idx),
    }));
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

  const openNewCollection = () => {
    setBatchDate(new Date().toISOString().slice(0, 10)); setBatchEntries({}); setBatchNotes(''); setEditingId(null); setShowModal(true);
  };

  return (
    <div className="animate-in">
      {/* Save feedback banners */}
      {successMsg && (
        <div role="status" style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          marginBottom: 12, background: '#d1fae5', border: '1px solid #10b981',
          borderRadius: 8, color: '#065f46', fontSize: 13, fontWeight: 600,
        }}>
          <Egg size={16} /> {successMsg}
        </div>
      )}
      {saveError && (
        <div role="alert" style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
          marginBottom: 12, background: '#fee2e2', border: '1px solid #ef4444',
          borderRadius: 8, color: '#991b1b', fontSize: 13,
        }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>Erro ao salvar.</strong>
            <div style={{ marginTop: 2, fontWeight: 400 }}>{saveError}</div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2>Coleta de Ovos</h2>
          <p>Controle diario de coleta e desempenho de postura</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => setShowEmployeeLink(!showEmployeeLink)} style={{ whiteSpace: 'nowrap' }}>
            <Link size={14} /> Acesso Funcionário
          </button>
          <button className="btn btn-primary" onClick={openNewCollection} style={{ whiteSpace: 'nowrap' }}>
            <Plus size={16} /> Nova Coleta
          </button>
        </div>
      </div>

      {/* Employee Link Panel */}
      {showEmployeeLink && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h4 style={{ fontSize: 14, marginBottom: 4 }}>Link de Acesso para Funcionários</h4>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                Compartilhe este link com os funcionários para que tenham acesso às páginas: Coleta de Ovos, Chocadeiras, Pintinhos e Sanidade.
              </p>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowEmployeeLink(false)}>
              <X size={14} />
            </button>
          </div>

          {employeeToken ? (
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="form-input"
                  readOnly
                  value={`${window.location.origin}${window.location.pathname}#/funcionario/${employeeToken}`}
                  style={{ flex: 1, minWidth: 200, fontSize: 12, background: 'var(--bg-secondary)' }}
                  onClick={e => e.target.select()}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const url = `${window.location.origin}${window.location.pathname}#/funcionario/${employeeToken}`;
                    navigator.clipboard.writeText(url).then(() => {
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    });
                  }}
                >
                  <Copy size={12} /> {linkCopied ? 'Copiado!' : 'Copiar'}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (confirm('Gerar novo link? O link anterior será invalidado.')) {
                      generateEmployeeToken();
                    }
                  }}
                  title="Gerar novo link"
                >
                  <RefreshCw size={12} /> Renovar
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ color: '#ef4444' }}
                  onClick={() => {
                    if (confirm('Revogar acesso dos funcionários? O link atual será invalidado.')) {
                      revokeEmployeeToken();
                    }
                  }}
                  title="Revogar acesso"
                >
                  <Trash size={12} /> Revogar
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, margin: 0 }}>
                Os funcionários poderão editar dados de Coleta de Ovos, Chocadeiras, Pintinhos e Sanidade diretamente. As alterações aparecem na conta principal.
              </p>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Nenhum link de acesso gerado ainda.
              </p>
              <button className="btn btn-primary" onClick={() => generateEmployeeToken()}>
                <Link size={14} /> Gerar Link de Acesso
              </button>
            </div>
          )}
        </div>
      )}

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
          <div className="stat-label">Media/Dia (Mes)</div>
          <div className="stat-value">{dailyAvg}</div>
        </div>
      </div>

      {/* Evolution Chart */}
      {allCollections.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">Evolucao de Coletas</span>
            <div className="period-selector">
              {[
                { key: 'daily', label: 'Diario' },
                { key: 'weekly', label: 'Semanal' },
                { key: 'monthly', label: 'Mensal' },
                { key: 'yearly', label: 'Anual' },
              ].map(p => (
                <button key={p.key} className={`period-btn ${chartPeriod === p.key ? 'active' : ''}`} onClick={() => setChartPeriod(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={evolutionData}>
                <defs>
                  <linearGradient id="colorOvos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="period" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="bons" name="Bons" stroke="#10B981" fill="url(#colorOvos)" strokeWidth={2} />
                <Area type="monotone" dataKey="trincados" name="Trincados" stroke="#EF4444" fill="none" strokeWidth={2} strokeDasharray="5 5" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top 10 Birds Chart */}
      {top10Data.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">Top 10 Aves - Maior Postura ({
              { daily: 'Hoje', weekly: 'Semana', monthly: 'Mes', yearly: 'Ano' }[chartPeriod]
            })</span>
          </div>
          <div style={{ padding: '16px 16px 8px', height: Math.max(200, top10Data.length * 40 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top10Data} layout="vertical" margin={{ left: 10, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" fontSize={11} />
                <YAxis type="category" dataKey="name" fontSize={11} width={120} tick={{ fill: 'var(--text)' }} />
                <Tooltip formatter={v => [`${v} ovos`, 'Quantidade']} />
                <Bar dataKey="eggs" name="Ovos" fill="#6C2BD9" radius={[0, 4, 4, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Calendar View */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">Calendario de Coletas</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-sm btn-secondary" onClick={() => navigateMonth(-1)} style={{ padding: '4px 8px' }}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontWeight: 600, fontSize: 14, minWidth: 140, textAlign: 'center' }}>
              {MONTH_NAMES_FULL[calendarMonth]} {calendarYear}
            </span>
            <button className="btn btn-sm btn-secondary" onClick={() => navigateMonth(1)} style={{ padding: '4px 8px' }}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {DAY_NAMES.map(d => (
                  <th key={d} style={{ padding: '8px 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calendarGrid.map((week, wi) => (
                <tr key={wi}>
                  {week.map((day, di) => {
                    const dayData = day ? calendarDaysData[day] : null;
                    const selected = day === selectedDay;
                    const today = day && isToday(day);
                    const intensity = dayData ? Math.min(dayData.total / maxDayEggs, 1) : 0;
                    return (
                      <td key={di} onClick={() => day && setSelectedDay(selected ? null : day)}
                        style={{
                          padding: 4, textAlign: 'center', verticalAlign: 'top', height: 68,
                          cursor: day ? 'pointer' : 'default',
                          border: selected ? '2px solid var(--primary)' : '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          background: selected ? 'var(--primary-bg)' : dayData ? `rgba(16, 185, 129, ${0.05 + intensity * 0.2})` : 'transparent',
                          transition: 'all 0.15s',
                        }}>
                        {day && (<>
                          <div style={{ fontSize: 12, fontWeight: today ? 700 : 400, color: today ? 'var(--primary)' : 'var(--text)', marginBottom: 2 }}>{day}</div>
                          {dayData ? (
                            <div>
                              <div style={{ fontSize: 16, fontWeight: 700, color: '#10B981', lineHeight: 1.2 }}>{dayData.total}</div>
                              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{dayData.total === 1 ? 'ovo' : 'ovos'}</div>
                              {dayData.cracked > 0 && <div style={{ fontSize: 9, color: 'var(--danger)', fontWeight: 600 }}>{dayData.cracked} trinc.</div>}
                            </div>
                          ) : (
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>-</div>
                          )}
                        </>)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Selected day detail */}
          {selectedDay && (
            <div style={{ marginTop: 16, padding: 16, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: 14 }}>
                  Coletas em {String(selectedDay).padStart(2, '0')}/{String(calendarMonth + 1).padStart(2, '0')}/{calendarYear}
                </h4>
                <button className="btn btn-sm btn-secondary" onClick={() => setSelectedDay(null)}><X size={14} /></button>
              </div>
              {selectedDayCollections.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12 }}>Ave / Raca</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: 12 }}>Ovos</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: 12 }}>Trincados</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: 12 }}>Bons</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12 }}>Obs</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: 12, width: 70 }}>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDayCollections.map(c => {
                      const bird = birds.find(b => b.id === c.birdId);
                      return (
                        <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 8px', fontSize: 13 }}><strong>{bird ? getBirdLabel(bird) : 'Ave removida'}</strong></td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600 }}>{c.quantity}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: (parseInt(c.cracked) || 0) > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{c.cracked || 0}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: 'var(--success)' }}>{(parseInt(c.quantity) || 0) - (parseInt(c.cracked) || 0)}</td>
                          <td style={{ padding: '6px 8px', fontSize: 12, color: 'var(--text-secondary)' }}>{c.notes || '-'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                              <button className="btn-icon" title="Editar" onClick={() => handleEdit(c)}><Edit2 size={13} /></button>
                              <button className="btn-icon" title="Excluir" onClick={() => handleDelete(c.id)} style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Nenhuma coleta neste dia.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bird Performance Cards */}
      {birds.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="card-title">Desempenho por Raca / Ave</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text" className="form-input" placeholder="Buscar ave..."
                  value={birdSearch} onChange={e => setBirdSearch(e.target.value)}
                  style={{ paddingLeft: 28, width: 180, height: 32, fontSize: 12 }}
                />
              </div>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setBirdSort(prev => prev === 'alpha' ? 'eggs' : 'alpha')}
                title={birdSort === 'alpha' ? 'Ordenar por producao' : 'Ordenar alfabetico'}
                style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
              >
                {birdSort === 'alpha' ? <><ArrowUpAZ size={14} /> A-Z</> : <><Egg size={14} /> Producao</>}
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, padding: 16 }}>
            {filteredBirds.map(bird => {
              const perf = birdPerformance[bird.id];
              if (!perf) return null;
              const isExpanded = expandedBird === bird.id;
              const hasConfig = parseInt(bird.annualEggPotential) > 0;
              const individuals = getIndividuals(bird);
              const activeBirds = perf.activeBirds;
              const totalBirds = individuals.length;
              const sickCount = individuals.filter(i => i.status === 'sick').length;
              const broodyCount = individuals.filter(i => i.status === 'broody').length;
              const deadCount = individuals.filter(i => i.status === 'dead').length;

              return (
                <div key={bird.id} style={{
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                  padding: 16, background: 'var(--bg-card)',
                }}>
                  {/* Bird header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: 'var(--primary-bg)', color: 'var(--primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Egg size={18} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{bird.species} - {bird.breed}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Heart size={10} color="#10B981" />
                            <strong style={{ color: '#10B981' }}>{activeBirds}</strong> ativas de {totalBirds}
                          </span>
                          {sickCount > 0 && <span style={{ fontSize: 10, color: BIRD_STATUS.sick.color, fontWeight: 600 }}>{sickCount} doente{sickCount > 1 ? 's' : ''}</span>}
                          {broodyCount > 0 && <span style={{ fontSize: 10, color: BIRD_STATUS.broody.color, fontWeight: 600 }}>{broodyCount} choca{broodyCount > 1 ? 's' : ''}</span>}
                          {deadCount > 0 && <span style={{ fontSize: 10, color: BIRD_STATUS.dead.color, fontWeight: 600 }}>{deadCount} morta{deadCount > 1 ? 's' : ''}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" title="Gerenciar aves" onClick={() => handleBirdConfig(bird)} style={{ color: 'var(--primary)' }}>
                        <Edit2 size={14} />
                      </button>
                      <button className="btn-icon" onClick={() => setExpandedBird(isExpanded ? null : bird.id)}>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Quick stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                    {[
                      { label: 'Semana', value: perf.weekEggs, perf: perf.weekPerf },
                      { label: 'Mes', value: perf.monthEggs, perf: perf.monthPerf },
                      { label: 'Ano', value: perf.yearEggs, perf: perf.yearPerf },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{s.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{s.value}</div>
                        {hasConfig && <div style={{ fontSize: 10, fontWeight: 600, color: getPerfColor(s.perf) }}>{s.perf.toFixed(0)}%</div>}
                      </div>
                    ))}
                  </div>

                  {/* Performance bar */}
                  {hasConfig && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Potencial: {perf.annualPotential} ovos/ano ({activeBirds} ativas x {bird.annualEggPotential})
                        </span>
                        <span style={{ fontWeight: 600, color: getPerfColor(perf.yearPerf) }}>{getPerfLabel(perf.yearPerf)}</span>
                      </div>
                      <div style={{ width: '100%', height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(perf.yearPerf, 100)}%`, height: '100%',
                          background: getPerfColor(perf.yearPerf), borderRadius: 3, transition: 'width 0.3s',
                        }} />
                      </div>
                    </div>
                  )}

                  {!hasConfig && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AlertTriangle size={12} /> Configure o potencial anual para ver analise de desempenho
                    </div>
                  )}

                  {perf.totalCracked > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AlertTriangle size={12} /> {perf.totalCracked} ovos trincados no total
                    </div>
                  )}

                  {/* Expanded: individual birds list */}
                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Aves Individuais</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {individuals.map((ind, i) => {
                          const st = BIRD_STATUS[ind.status] || BIRD_STATUS.active;
                          return (
                            <div key={ind.id || i} style={{
                              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                              background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)',
                              borderLeft: `3px solid ${st.color}`,
                            }}>
                              <span style={{ fontSize: 12, fontWeight: 600, minWidth: 20 }}>#{i + 1}</span>
                              {ind.ringNumber && (
                                <span style={{
                                  fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                                  background: '#e2e8f0', color: 'var(--text)',
                                }}>
                                  {ind.ringNumber}
                                </span>
                              )}
                              <span style={{
                                fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                                background: st.bg, color: st.color,
                              }}>
                                {st.label}
                              </span>
                              {ind.notes && <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>{ind.notes}</span>}
                            </div>
                          );
                        })}
                      </div>

                      {/* Stats */}
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10 }}>
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
                              <span>Potencial semanal ({activeBirds} ativas):</span>
                              <strong style={{ color: 'var(--text-primary)' }}>{(perf.annualPotential / 52).toFixed(1)} ovos</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span>Potencial mensal ({activeBirds} ativas):</span>
                              <strong style={{ color: 'var(--text-primary)' }}>{(perf.annualPotential / 12).toFixed(1)} ovos</strong>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredBirds.length === 0 && birdSearch && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, gridColumn: '1 / -1' }}>
                Nenhuma ave encontrada para "{birdSearch}"
              </div>
            )}
          </div>
        </div>
      )}

      {allCollections.length === 0 && (
        <div className="empty-state">
          <Egg size={48} />
          <h3>Nenhuma coleta registrada</h3>
          <p>Registre a coleta diaria de ovos para acompanhar o desempenho do plantel</p>
        </div>
      )}

      {/* Add/Edit Collection Modal */}
      {showModal && (
        <Portal><div className="modal-overlay" onClick={() => setShowModal(false)}>
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
                        {[...birds].sort((a, b) => getBirdLabel(a).localeCompare(getBirdLabel(b))).map(b => <option key={b.id} value={b.id}>{getBirdLabel(b)}</option>)}
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
                    <input className="form-input" type="text" value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Ex: Ovos para chocadeira..." />
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
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>{batchCrackedTotal} trincados</div>
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
                          {[...birds].sort((a, b) => getBirdLabel(a).localeCompare(getBirdLabel(b))).map(bird => {
                            const entry = batchEntries[bird.id] || { quantity: '', cracked: '' };
                            const active = getActiveBirdCount(bird);
                            const total = (getIndividuals(bird)).length;
                            return (
                              <tr key={bird.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '8px 12px' }}>
                                  <div style={{ fontWeight: 600, fontSize: 13 }}>{bird.species} - {bird.breed}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                    {active} ativa{active !== 1 ? 's' : ''} de {total}
                                  </div>
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                  <input className="form-input" type="number" min="0" value={entry.quantity}
                                    onChange={e => updateBatchEntry(bird.id, 'quantity', e.target.value)}
                                    placeholder="0" style={{ width: 70, textAlign: 'center', padding: '6px 4px', margin: '0 auto' }} />
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                  <input className="form-input" type="number" min="0" value={entry.cracked}
                                    onChange={e => updateBatchEntry(bird.id, 'cracked', e.target.value)}
                                    placeholder="0" style={{ width: 70, textAlign: 'center', padding: '6px 4px', margin: '0 auto' }} />
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
        </div></Portal>
      )}

      {/* Bird Config Modal - Individual bird management */}
      {showBirdConfigModal && (
        <Portal><div className="modal-overlay" onClick={() => setShowBirdConfigModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <h3 className="modal-title">Gerenciar Aves</h3>
            {(() => {
              const bird = birds.find(b => b.id === showBirdConfigModal);
              if (!bird) return null;
              const activeCount = birdConfigForm.individuals.filter(i => i.status === 'active').length;
              const totalCount = birdConfigForm.individuals.length;
              return (
                <>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                    {bird.species} - {bird.breed} — <strong style={{ color: '#10B981' }}>{activeCount} ativas</strong> de {totalCount} aves
                  </p>

                  <div className="form-group" style={{ marginBottom: 16 }}>
                    <label className="form-label">Potencial Anual de Ovos (por ave)</label>
                    <input className="form-input" type="number" min="0" value={birdConfigForm.annualEggPotential}
                      onChange={e => setBirdConfigForm(prev => ({ ...prev, annualEggPotential: e.target.value }))}
                      placeholder="Ex: 180, 250, 300..." />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                      Quantidade media por ave por ano. Ex: Ganso = 40, Galinha caipira = 180
                    </span>
                  </div>

                  {/* Individual birds table */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label className="form-label" style={{ margin: 0 }}>Aves Individuais</label>
                      <button type="button" className="btn btn-sm btn-secondary" onClick={addIndividual} style={{ fontSize: 11, padding: '4px 8px' }}>
                        <Plus size={12} /> Adicionar Ave
                      </button>
                    </div>
                    <div style={{ maxHeight: 350, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: 1 }}>
                            <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: 11, fontWeight: 600, width: 36 }}>#</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600 }}>Anilha</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, width: 120 }}>Status</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600 }}>Obs</th>
                            <th style={{ padding: '6px 8px', textAlign: 'center', fontSize: 11, fontWeight: 600, width: 40 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {birdConfigForm.individuals.map((ind, idx) => {
                            const st = BIRD_STATUS[ind.status] || BIRD_STATUS.active;
                            return (
                              <tr key={ind.id || idx} style={{ borderBottom: '1px solid var(--border)', background: ind.status === 'dead' ? '#fef2f233' : undefined }}>
                                <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: 12, fontWeight: 600 }}>{idx + 1}</td>
                                <td style={{ padding: '4px 6px' }}>
                                  <input className="form-input" type="text" value={ind.ringNumber}
                                    onChange={e => updateIndividual(idx, 'ringNumber', e.target.value)}
                                    placeholder="Anilha" style={{ fontSize: 12, padding: '4px 8px', height: 30 }} />
                                </td>
                                <td style={{ padding: '4px 6px' }}>
                                  <select className="form-input" value={ind.status}
                                    onChange={e => updateIndividual(idx, 'status', e.target.value)}
                                    style={{ fontSize: 12, padding: '4px 6px', height: 30, color: st.color, fontWeight: 600 }}>
                                    {Object.entries(BIRD_STATUS).map(([key, val]) => (
                                      <option key={key} value={key}>{val.label}</option>
                                    ))}
                                  </select>
                                </td>
                                <td style={{ padding: '4px 6px' }}>
                                  <input className="form-input" type="text" value={ind.notes}
                                    onChange={e => updateIndividual(idx, 'notes', e.target.value)}
                                    placeholder="Obs..." style={{ fontSize: 12, padding: '4px 8px', height: 30 }} />
                                </td>
                                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                  {birdConfigForm.individuals.length > 1 && (
                                    <button type="button" className="btn-icon" onClick={() => removeIndividual(idx)}
                                      style={{ color: 'var(--danger)', padding: 2 }} title="Remover">
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Observacoes Gerais</label>
                    <input className="form-input" type="text" value={birdConfigForm.notes}
                      onChange={e => setBirdConfigForm(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="Ex: Idade, origem, observacoes gerais..." />
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
        </div></Portal>
      )}
    </div>
  );
}
