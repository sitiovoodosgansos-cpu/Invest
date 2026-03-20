import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { formatDate } from '../utils/helpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import {
  Plus, Trash2, Edit2, Search, Save, X, Heart, Activity, AlertTriangle,
  ChevronDown, ChevronUp, Pill, Shield, Bug, Eye, Skull, ArrowRightLeft
} from 'lucide-react';

const MONTH_NAMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

const ADMISSION_STATUS = {
  active: { label: 'Em Tratamento', color: '#f59e0b', bg: '#fef3c7' },
  recovered: { label: 'Recuperada', color: '#10b981', bg: '#d1fae5' },
  died: { label: 'Óbito', color: '#ef4444', bg: '#fee2e2' },
  transferred: { label: 'Transferida', color: '#6366f1', bg: '#e0e7ff' },
};

const DEFAULT_TREATMENT_TYPES = [
  'Piolhicida',
  'Vermifugação',
  'Antibiótico',
  'Anti-inflamatório',
  'Vitaminas',
];

const TREATMENT_COLORS = ['#6C2BD9', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6'];

export default function Sanidade() {
  const {
    birds,
    infirmaryBays, infirmaryAdmissions, treatments, customTreatmentTypes,
    addInfirmaryBay, updateInfirmaryBay, deleteInfirmaryBay,
    addInfirmaryAdmission, updateInfirmaryAdmission, deleteInfirmaryAdmission,
    addTreatment, updateTreatment, deleteTreatment,
    addCustomTreatmentType, deleteCustomTreatmentType,
  } = useApp();

  const allBays = infirmaryBays || [];
  const allAdmissions = infirmaryAdmissions || [];
  const allTreatments = treatments || [];
  const allCustomTypes = customTreatmentTypes || [];

  const treatmentTypeOptions = useMemo(() => {
    const custom = allCustomTypes.map(t => t.name);
    return [...DEFAULT_TREATMENT_TYPES, ...custom.filter(c => !DEFAULT_TREATMENT_TYPES.includes(c))];
  }, [allCustomTypes]);

  // Tab state
  const [activeTab, setActiveTab] = useState('bays');

  // Bay modal
  const [showBayModal, setShowBayModal] = useState(false);
  const [editingBay, setEditingBay] = useState(null);
  const [bayForm, setBayForm] = useState({ name: '', capacity: '', notes: '' });

  // Admission modal
  const [showAdmissionModal, setShowAdmissionModal] = useState(false);
  const [editingAdmission, setEditingAdmission] = useState(null);
  const [admissionForm, setAdmissionForm] = useState({
    bayId: '', birdId: '', birdLabel: '', disease: '', symptoms: '',
    dateIn: '', dateOut: '', status: 'active', medications: '', notes: '',
    transferToBayId: '',
  });

  // Treatment modal
  const [showTreatmentModal, setShowTreatmentModal] = useState(false);
  const [editingTreatment, setEditingTreatment] = useState(null);
  const [treatmentForm, setTreatmentForm] = useState({
    birdId: '', treatmentType: '', date: '', product: '', dosage: '', notes: '',
  });

  // Custom treatment type
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  // Search
  const [searchTerm, setSearchTerm] = useState('');

  // Expanded bay
  const [expandedBay, setExpandedBay] = useState(null);

  // ── Bird lookup helpers ──
  const allBirds = birds || [];
  const birdOptions = useMemo(() => {
    const opts = [];
    for (const bird of allBirds) {
      const individuals = bird.individuals || [];
      if (individuals.length > 0) {
        for (const ind of individuals) {
          opts.push({
            id: `${bird.id}:${ind.id}`,
            label: `${bird.breed || bird.species} - ${ind.ringNumber || ind.name || `Ave ${ind.id}`}`,
            birdId: bird.id,
            individualId: ind.id,
            species: bird.species,
            breed: bird.breed,
          });
        }
      } else {
        opts.push({
          id: bird.id,
          label: `${bird.breed || bird.species} (Plantel)`,
          birdId: bird.id,
          species: bird.species,
          breed: bird.breed,
        });
      }
    }
    return opts;
  }, [allBirds]);

  // ── Stats ──
  const stats = useMemo(() => {
    // Exclude admissions that were created via transfer (to avoid double-counting sick birds)
    const originalAdmissions = allAdmissions.filter(a => !a.transferredFromAdmissionId);
    const activeAdmissions = allAdmissions.filter(a => a.status === 'active');
    const recovered = originalAdmissions.filter(a => a.status === 'recovered');
    const died = originalAdmissions.filter(a => a.status === 'died');
    const total = originalAdmissions.length;
    const recoveryRate = total > 0 ? Math.round((recovered.length / (recovered.length + died.length || 1)) * 100) : 0;

    // Deaths per month (last 12 months)
    const now = new Date();
    const monthlyDeaths = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const count = died.filter(a => a.dateOut && a.dateOut.startsWith(key)).length;
      monthlyDeaths.push({ month: `${MONTH_NAMES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, deaths: count });
    }

    // Disease frequency (exclude transfers to avoid double-counting)
    const diseaseMap = {};
    for (const a of originalAdmissions) {
      if (a.disease) {
        diseaseMap[a.disease] = (diseaseMap[a.disease] || 0) + 1;
      }
    }
    const diseaseChart = Object.entries(diseaseMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));

    // Treatment type counts
    const treatmentMap = {};
    for (const t of allTreatments) {
      const type = t.treatmentType || 'Outro';
      treatmentMap[type] = (treatmentMap[type] || 0) + 1;
    }
    const treatmentSorted = Object.entries(treatmentMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
    let treatmentChart;
    if (treatmentSorted.length <= 5) {
      treatmentChart = treatmentSorted;
    } else {
      treatmentChart = treatmentSorted.slice(0, 5);
      const othersVal = treatmentSorted.slice(5).reduce((s, d) => s + d.value, 0);
      if (othersVal > 0) treatmentChart.push({ name: 'Outros', value: othersVal });
    }

    // Medications per bay
    const medsPerBay = {};
    for (const a of allAdmissions) {
      if (a.bayId && a.medications) {
        if (!medsPerBay[a.bayId]) medsPerBay[a.bayId] = new Set();
        a.medications.split(',').forEach(m => { if (m.trim()) medsPerBay[a.bayId].add(m.trim()); });
      }
    }

    return {
      activeCount: activeAdmissions.length,
      recoveredCount: recovered.length,
      deathCount: died.length,
      totalAdmissions: total,
      recoveryRate,
      monthlyDeaths,
      diseaseChart,
      treatmentChart,
      medsPerBay,
    };
  }, [allAdmissions, allTreatments]);

  // ── Bay handlers ──
  function openBayModal(bay) {
    if (bay) {
      setEditingBay(bay);
      setBayForm({ name: bay.name, capacity: bay.capacity || '', notes: bay.notes || '' });
    } else {
      setEditingBay(null);
      setBayForm({ name: '', capacity: '', notes: '' });
    }
    setShowBayModal(true);
  }

  function saveBay() {
    if (!bayForm.name.trim()) return;
    const data = { name: bayForm.name.trim(), capacity: Number(bayForm.capacity) || 0, notes: bayForm.notes.trim() };
    if (editingBay) {
      updateInfirmaryBay(editingBay.id, data);
    } else {
      addInfirmaryBay(data);
    }
    setShowBayModal(false);
  }

  function removeBay(id) {
    if (confirm('Excluir esta baia e todas as internações associadas?')) {
      deleteInfirmaryBay(id);
    }
  }

  // ── Admission handlers ──
  function openAdmissionModal(bayId, admission) {
    if (admission) {
      setEditingAdmission(admission);
      setAdmissionForm({
        bayId: admission.bayId, birdId: admission.birdId || '', birdLabel: admission.birdLabel || '',
        disease: admission.disease || '', symptoms: admission.symptoms || '',
        dateIn: admission.dateIn || '', dateOut: admission.dateOut || '',
        status: admission.status || 'active', medications: admission.medications || '',
        notes: admission.notes || '', transferToBayId: admission.transferToBayId || '',
      });
    } else {
      setEditingAdmission(null);
      setAdmissionForm({
        bayId: bayId || '', birdId: '', birdLabel: '', disease: '', symptoms: '',
        dateIn: new Date().toISOString().slice(0, 10), dateOut: '', status: 'active',
        medications: '', notes: '', transferToBayId: '',
      });
    }
    setShowAdmissionModal(true);
  }

  function saveAdmission() {
    if (!admissionForm.bayId) return;
    const selectedBird = birdOptions.find(b => b.id === admissionForm.birdId);
    const data = {
      ...admissionForm,
      birdLabel: selectedBird ? selectedBird.label : admissionForm.birdLabel || 'Ave não identificada',
    };
    if (data.status === 'recovered' || data.status === 'died' || data.status === 'transferred') {
      if (!data.dateOut) data.dateOut = new Date().toISOString().slice(0, 10);
    }

    // Handle transfer: validate destination bay is selected
    if (data.status === 'transferred' && !data.transferToBayId) {
      alert('Selecione a baia de destino para a transferência.');
      return;
    }

    if (editingAdmission) {
      updateInfirmaryAdmission(editingAdmission.id, data);

      // If transferring, auto-create a new linked admission in the destination bay
      if (data.status === 'transferred' && data.transferToBayId && data.transferToBayId !== editingAdmission.transferToBayId) {
        const today = new Date().toISOString().slice(0, 10);
        addInfirmaryAdmission({
          bayId: data.transferToBayId,
          birdId: data.birdId,
          birdLabel: data.birdLabel,
          disease: data.disease,
          symptoms: data.symptoms,
          medications: data.medications,
          dateIn: today,
          dateOut: '',
          status: 'active',
          notes: `Transferida da baia "${getBayName(data.bayId)}" em ${today}`,
          transferredFromAdmissionId: editingAdmission.id,
        });
      }
    } else {
      addInfirmaryAdmission(data);
    }
    setShowAdmissionModal(false);
  }

  function removeAdmission(id) {
    if (confirm('Excluir esta internação?')) deleteInfirmaryAdmission(id);
  }

  // ── Treatment handlers ──
  function openTreatmentModal(treatment) {
    if (treatment) {
      setEditingTreatment(treatment);
      setTreatmentForm({
        birdId: treatment.birdId || '', treatmentType: treatment.treatmentType || '',
        date: treatment.date || '', product: treatment.product || '',
        dosage: treatment.dosage || '', notes: treatment.notes || '',
      });
    } else {
      setEditingTreatment(null);
      setTreatmentForm({
        birdId: '', treatmentType: '', date: new Date().toISOString().slice(0, 10),
        product: '', dosage: '', notes: '',
      });
    }
    setShowTreatmentModal(true);
  }

  function saveTreatment() {
    if (!treatmentForm.treatmentType || !treatmentForm.date) return;
    const selectedBird = birdOptions.find(b => b.id === treatmentForm.birdId);
    const data = {
      ...treatmentForm,
      birdLabel: selectedBird ? selectedBird.label : 'Plantel geral',
    };
    if (editingTreatment) {
      updateTreatment(editingTreatment.id, data);
    } else {
      addTreatment(data);
    }
    setShowTreatmentModal(false);
  }

  function removeTreatment(id) {
    if (confirm('Excluir este tratamento?')) deleteTreatment(id);
  }

  // ── Custom treatment type ──
  function saveCustomType() {
    if (!newTypeName.trim()) return;
    addCustomTreatmentType({ name: newTypeName.trim() });
    setNewTypeName('');
    setShowTypeModal(false);
  }

  // ── Filtered admissions for search ──
  const filteredAdmissions = useMemo(() => {
    if (!searchTerm.trim()) return allAdmissions;
    const term = searchTerm.toLowerCase();
    return allAdmissions.filter(a =>
      (a.birdLabel || '').toLowerCase().includes(term) ||
      (a.disease || '').toLowerCase().includes(term) ||
      (a.medications || '').toLowerCase().includes(term) ||
      (a.notes || '').toLowerCase().includes(term)
    );
  }, [allAdmissions, searchTerm]);

  // ── Render helpers ──
  function getBayAdmissions(bayId) {
    return allAdmissions.filter(a => a.bayId === bayId);
  }

  function getBayName(bayId) {
    const bay = allBays.find(b => b.id === bayId);
    return bay ? bay.name : 'Baia removida';
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Sanidade</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Controle de enfermaria, tratamentos e saúde do plantel
          </p>
        </div>
      </div>

      {/* ── Stats Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <Activity size={20} style={{ color: '#f59e0b', marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{stats.activeCount}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Em Tratamento</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <Heart size={20} style={{ color: '#10b981', marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981' }}>{stats.recoveredCount}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Recuperadas</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <Skull size={20} style={{ color: '#ef4444', marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{stats.deathCount}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Óbitos</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <Shield size={20} style={{ color: '#6C2BD9', marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: '#6C2BD9' }}>{stats.recoveryRate}%</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Taxa Recuperação</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <Pill size={20} style={{ color: '#3b82f6', marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: '#3b82f6' }}>{allTreatments.length}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Tratamentos</div>
        </div>
      </div>

      {/* ── Charts ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
        {/* Monthly deaths */}
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ marginBottom: 12, fontSize: 14 }}>Óbitos por Mês (12 meses)</h4>
          {stats.monthlyDeaths.some(d => d.deaths > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.monthlyDeaths}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="deaths" fill="#ef4444" name="Óbitos" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              Sem óbitos registrados
            </div>
          )}
        </div>

        {/* Disease frequency */}
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ marginBottom: 12, fontSize: 14 }}>Doenças Mais Frequentes</h4>
          {stats.diseaseChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.diseaseChart} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="value" fill="#6C2BD9" name="Casos" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              Sem dados de doenças
            </div>
          )}
        </div>

        {/* Treatment types pie */}
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ marginBottom: 12, fontSize: 14 }}>Tratamentos por Tipo</h4>
          {stats.treatmentChart.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={stats.treatmentChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                    {stats.treatmentChart.map((_, i) => (
                      <Cell key={i} fill={TREATMENT_COLORS[i % TREATMENT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 12 }}>
                {stats.treatmentChart.map((t, i) => (
                  <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: TREATMENT_COLORS[i % TREATMENT_COLORS.length], display: 'inline-block' }} />
                    {t.name}: {t.value}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              Sem tratamentos registrados
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'bays', label: 'Baias de Enfermaria', icon: <Activity size={14} /> },
          { key: 'treatments', label: 'Tratamentos do Plantel', icon: <Pill size={14} /> },
          { key: 'search', label: 'Pesquisar Ave', icon: <Search size={14} /> },
        ].map(tab => (
          <button
            key={tab.key}
            className={`btn ${activeTab === tab.key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(tab.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ════════ TAB: Baias de Enfermaria ════════ */}
      {activeTab === 'bays' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16 }}>Baias de Enfermaria ({allBays.length})</h3>
            <button className="btn btn-primary" onClick={() => openBayModal(null)}>
              <Plus size={16} /> Nova Baia
            </button>
          </div>

          {allBays.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Nenhuma baia de enfermaria cadastrada. Clique em "Nova Baia" para começar.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {allBays.map(bay => {
                const bayAdmissions = getBayAdmissions(bay.id);
                const activeInBay = bayAdmissions.filter(a => a.status === 'active');
                const recoveredInBay = bayAdmissions.filter(a => a.status === 'recovered');
                const diedInBay = bayAdmissions.filter(a => a.status === 'died');
                const isExpanded = expandedBay === bay.id;
                const bayMeds = stats.medsPerBay[bay.id];

                return (
                  <div key={bay.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* Bay header */}
                    <div
                      style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: isExpanded ? 'var(--bg-secondary)' : 'transparent' }}
                      onClick={() => setExpandedBay(isExpanded ? null : bay.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{bay.name}</div>
                          {bay.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{bay.notes}</div>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#fef3c7', color: '#92400e' }}>
                          {activeInBay.length} ativas
                        </span>
                        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#d1fae5', color: '#065f46' }}>
                          {recoveredInBay.length} recup.
                        </span>
                        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#fee2e2', color: '#991b1b' }}>
                          {diedInBay.length} óbitos
                        </span>
                        {bay.capacity > 0 && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Cap: {bay.capacity}
                          </span>
                        )}
                        <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); openBayModal(bay); }}>
                          <Edit2 size={12} />
                        </button>
                        <button className="btn btn-sm btn-secondary" style={{ color: '#ef4444' }} onClick={(e) => { e.stopPropagation(); removeBay(bay.id); }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Bay medications */}
                    {bayMeds && bayMeds.size > 0 && (
                      <div style={{ padding: '4px 16px', background: 'var(--bg-secondary)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Pill size={12} style={{ color: 'var(--text-muted)' }} />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Medicamentos:</span>
                        {[...bayMeds].map(m => (
                          <span key={m} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: '#e0e7ff', color: '#3730a3' }}>
                            {m}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Expanded: admissions list */}
                    {isExpanded && (
                      <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>Internações ({bayAdmissions.length})</span>
                          <button className="btn btn-sm btn-primary" onClick={() => openAdmissionModal(bay.id, null)}>
                            <Plus size={12} /> Internar Ave
                          </button>
                        </div>

                        {bayAdmissions.length === 0 ? (
                          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
                            Nenhuma ave internada nesta baia.
                          </p>
                        ) : (
                          <div style={{ display: 'grid', gap: 8 }}>
                            {bayAdmissions.sort((a, b) => (b.dateIn || '').localeCompare(a.dateIn || '')).map(adm => {
                              const statusInfo = ADMISSION_STATUS[adm.status] || ADMISSION_STATUS.active;
                              return (
                                <div key={adm.id} style={{ padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: 200 }}>
                                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{adm.birdLabel || 'Ave não identificada'}</div>
                                      {adm.disease && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                          <Bug size={12} style={{ color: '#ef4444' }} />
                                          <span style={{ fontSize: 12 }}>Doença: {adm.disease}</span>
                                        </div>
                                      )}
                                      {adm.symptoms && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>Sintomas: {adm.symptoms}</div>}
                                      {adm.medications && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>Medicamentos: {adm.medications}</div>}
                                      {adm.transferredFromAdmissionId && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, fontSize: 12, color: '#6366f1' }}>
                                          <ArrowRightLeft size={11} /> Transferida de outra baia
                                        </div>
                                      )}
                                      {adm.transferToBayId && adm.status === 'transferred' && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, fontSize: 12, color: '#6366f1' }}>
                                          <ArrowRightLeft size={11} /> Transferida para: {getBayName(adm.transferToBayId)}
                                        </div>
                                      )}
                                      {adm.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>{adm.notes}</div>}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: statusInfo.bg, color: statusInfo.color, fontWeight: 600 }}>
                                        {statusInfo.label}
                                      </span>
                                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                        Entrada: {formatDate(adm.dateIn)}
                                      </span>
                                      {adm.dateOut && (
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                          Saída: {formatDate(adm.dateOut)}
                                        </span>
                                      )}
                                      <div style={{ display: 'flex', gap: 4 }}>
                                        <button className="btn btn-sm btn-secondary" onClick={() => openAdmissionModal(bay.id, adm)}>
                                          <Edit2 size={11} />
                                        </button>
                                        <button className="btn btn-sm btn-secondary" style={{ color: '#ef4444' }} onClick={() => removeAdmission(adm.id)}>
                                          <Trash2 size={11} />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════ TAB: Tratamentos do Plantel ════════ */}
      {activeTab === 'treatments' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ fontSize: 16 }}>Tratamentos do Plantel ({allTreatments.length})</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setShowTypeModal(true)}>
                <Plus size={14} /> Tipo Tratamento
              </button>
              <button className="btn btn-primary" onClick={() => openTreatmentModal(null)}>
                <Plus size={14} /> Novo Tratamento
              </button>
            </div>
          </div>

          {/* Treatment type tags */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {treatmentTypeOptions.map(type => {
              const count = allTreatments.filter(t => t.treatmentType === type).length;
              return (
                <span key={type} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                  {type} ({count})
                </span>
              );
            })}
          </div>

          {allTreatments.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Nenhum tratamento registrado. Clique em "Novo Tratamento" para começar.
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Ave / Plantel</th>
                    <th>Tipo</th>
                    <th>Produto</th>
                    <th>Dosagem</th>
                    <th>Obs.</th>
                    <th style={{ width: 80 }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {[...allTreatments].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(t => (
                    <tr key={t.id}>
                      <td>{formatDate(t.date)}</td>
                      <td>{t.birdLabel || 'Plantel geral'}</td>
                      <td>
                        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#f3e8ff', color: '#6C2BD9', fontWeight: 500 }}>
                          {t.treatmentType}
                        </span>
                      </td>
                      <td>{t.product || '-'}</td>
                      <td>{t.dosage || '-'}</td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.notes || '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => openTreatmentModal(t)}>
                            <Edit2 size={12} />
                          </button>
                          <button className="btn btn-sm btn-secondary" style={{ color: '#ef4444' }} onClick={() => removeTreatment(t.id)}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ════════ TAB: Pesquisar Ave ════════ */}
      {activeTab === 'search' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Pesquisar Ave Específica</h3>
            <div style={{ position: 'relative', maxWidth: 400 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Buscar por ave, doença, medicamento..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ paddingLeft: 36 }}
              />
            </div>
          </div>

          {filteredAdmissions.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              {searchTerm ? 'Nenhum resultado encontrado.' : 'Nenhuma internação registrada.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {filteredAdmissions.sort((a, b) => (b.dateIn || '').localeCompare(a.dateIn || '')).map(adm => {
                const statusInfo = ADMISSION_STATUS[adm.status] || ADMISSION_STATUS.active;
                return (
                  <div key={adm.id} className="card" style={{ padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{adm.birdLabel || 'Ave não identificada'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                          Baia: {getBayName(adm.bayId)}
                        </div>
                        {adm.disease && <div style={{ fontSize: 12 }}><Bug size={11} style={{ color: '#ef4444' }} /> {adm.disease}</div>}
                        {adm.symptoms && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Sintomas: {adm.symptoms}</div>}
                        {adm.medications && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Medicamentos: {adm.medications}</div>}
                        {adm.transferredFromAdmissionId && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, fontSize: 12, color: '#6366f1' }}>
                            <ArrowRightLeft size={11} /> Transferida de outra baia
                          </div>
                        )}
                        {adm.transferToBayId && adm.status === 'transferred' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, fontSize: 12, color: '#6366f1' }}>
                            <ArrowRightLeft size={11} /> Transferida para: {getBayName(adm.transferToBayId)}
                          </div>
                        )}
                        {adm.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>{adm.notes}</div>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: statusInfo.bg, color: statusInfo.color, fontWeight: 600 }}>
                          {statusInfo.label}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Entrada: {formatDate(adm.dateIn)}</span>
                        {adm.dateOut && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Saída: {formatDate(adm.dateOut)}</span>}
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => openAdmissionModal(adm.bayId, adm)}>
                            <Edit2 size={11} />
                          </button>
                          <button className="btn btn-sm btn-secondary" style={{ color: '#ef4444' }} onClick={() => removeAdmission(adm.id)}>
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════ MODAL: Bay ════════ */}
      {showBayModal && (
        <div className="modal-overlay" onClick={() => setShowBayModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3>{editingBay ? 'Editar Baia' : 'Nova Baia de Enfermaria'}</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowBayModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Nome da Baia *</label>
                <input className="form-input" value={bayForm.name} onChange={e => setBayForm({ ...bayForm, name: e.target.value })} placeholder="Ex: Enfermaria 1" />
              </div>
              <div className="form-group">
                <label>Capacidade</label>
                <input className="form-input" type="number" value={bayForm.capacity} onChange={e => setBayForm({ ...bayForm, capacity: e.target.value })} placeholder="Número de aves" />
              </div>
              <div className="form-group">
                <label>Observações</label>
                <textarea className="form-input" rows={3} value={bayForm.notes} onChange={e => setBayForm({ ...bayForm, notes: e.target.value })} placeholder="Notas sobre esta baia..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBayModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveBay}><Save size={14} /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ MODAL: Admission ════════ */}
      {showAdmissionModal && (
        <div className="modal-overlay" onClick={() => setShowAdmissionModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3>{editingAdmission ? 'Editar Internação' : 'Nova Internação'}</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowAdmissionModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Baia *</label>
                <select className="form-input" value={admissionForm.bayId} onChange={e => setAdmissionForm({ ...admissionForm, bayId: e.target.value })}>
                  <option value="">Selecione a baia</option>
                  {allBays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Ave</label>
                <select className="form-input" value={admissionForm.birdId} onChange={e => setAdmissionForm({ ...admissionForm, birdId: e.target.value })}>
                  <option value="">Selecione a ave (opcional)</option>
                  {birdOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Doença / Diagnóstico</label>
                  <input className="form-input" value={admissionForm.disease} onChange={e => setAdmissionForm({ ...admissionForm, disease: e.target.value })} placeholder="Ex: Coriza, Bouba..." />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select className="form-input" value={admissionForm.status} onChange={e => {
                    const newStatus = e.target.value;
                    setAdmissionForm({ ...admissionForm, status: newStatus, transferToBayId: newStatus === 'transferred' ? admissionForm.transferToBayId : '' });
                  }}>
                    {Object.entries(ADMISSION_STATUS).map(([key, val]) => (
                      <option key={key} value={key}>{val.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              {admissionForm.status === 'transferred' && (
                <div className="form-group" style={{ background: '#e0e7ff', padding: 12, borderRadius: 8, border: '1px solid #c7d2fe' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4338ca', fontWeight: 600 }}>
                    <ArrowRightLeft size={14} /> Baia de Destino *
                  </label>
                  <select
                    className="form-input"
                    value={admissionForm.transferToBayId}
                    onChange={e => setAdmissionForm({ ...admissionForm, transferToBayId: e.target.value })}
                    style={{ borderColor: '#818cf8' }}
                  >
                    <option value="">Selecione a baia de destino</option>
                    {allBays.filter(b => b.id !== admissionForm.bayId).map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <p style={{ fontSize: 11, color: '#6366f1', marginTop: 4 }}>
                    A ave será automaticamente internada na baia de destino sem duplicar a contagem.
                  </p>
                </div>
              )}
              <div className="form-group">
                <label>Sintomas</label>
                <input className="form-input" value={admissionForm.symptoms} onChange={e => setAdmissionForm({ ...admissionForm, symptoms: e.target.value })} placeholder="Descreva os sintomas observados" />
              </div>
              <div className="form-group">
                <label>Medicamentos</label>
                <input className="form-input" value={admissionForm.medications} onChange={e => setAdmissionForm({ ...admissionForm, medications: e.target.value })} placeholder="Ex: Enrofloxacina, Ivermectina (separar por vírgula)" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Data Entrada</label>
                  <input className="form-input" type="date" value={admissionForm.dateIn} onChange={e => setAdmissionForm({ ...admissionForm, dateIn: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Data Saída</label>
                  <input className="form-input" type="date" value={admissionForm.dateOut} onChange={e => setAdmissionForm({ ...admissionForm, dateOut: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Observações</label>
                <textarea className="form-input" rows={3} value={admissionForm.notes} onChange={e => setAdmissionForm({ ...admissionForm, notes: e.target.value })} placeholder="Observações sobre esta internação..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAdmissionModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveAdmission}><Save size={14} /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ MODAL: Treatment ════════ */}
      {showTreatmentModal && (
        <div className="modal-overlay" onClick={() => setShowTreatmentModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h3>{editingTreatment ? 'Editar Tratamento' : 'Novo Tratamento'}</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowTreatmentModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Ave / Casinha (opcional)</label>
                <select className="form-input" value={treatmentForm.birdId} onChange={e => setTreatmentForm({ ...treatmentForm, birdId: e.target.value })}>
                  <option value="">Plantel geral</option>
                  {birdOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Tipo de Tratamento *</label>
                  <select className="form-input" value={treatmentForm.treatmentType} onChange={e => setTreatmentForm({ ...treatmentForm, treatmentType: e.target.value })}>
                    <option value="">Selecione</option>
                    {treatmentTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Data *</label>
                  <input className="form-input" type="date" value={treatmentForm.date} onChange={e => setTreatmentForm({ ...treatmentForm, date: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Produto</label>
                  <input className="form-input" value={treatmentForm.product} onChange={e => setTreatmentForm({ ...treatmentForm, product: e.target.value })} placeholder="Nome do produto" />
                </div>
                <div className="form-group">
                  <label>Dosagem</label>
                  <input className="form-input" value={treatmentForm.dosage} onChange={e => setTreatmentForm({ ...treatmentForm, dosage: e.target.value })} placeholder="Ex: 1ml/L água" />
                </div>
              </div>
              <div className="form-group">
                <label>Observações</label>
                <textarea className="form-input" rows={3} value={treatmentForm.notes} onChange={e => setTreatmentForm({ ...treatmentForm, notes: e.target.value })} placeholder="Notas adicionais..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowTreatmentModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveTreatment}><Save size={14} /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ MODAL: Custom Treatment Type ════════ */}
      {showTypeModal && (
        <div className="modal-overlay" onClick={() => setShowTypeModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-header">
              <h3>Novo Tipo de Tratamento</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowTypeModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Nome do Tipo *</label>
                <input className="form-input" value={newTypeName} onChange={e => setNewTypeName(e.target.value)} placeholder="Ex: Vacina Newcastle" />
              </div>
              {allCustomTypes.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: 'block' }}>Tipos Customizados:</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {allCustomTypes.map(t => (
                      <span key={t.id} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#f3e8ff', color: '#6C2BD9', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {t.name}
                        <button onClick={() => { if (window.confirm(`Excluir tipo "${t.name}"?`)) deleteCustomTreatmentType(t.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#ef4444' }}>
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowTypeModal(false)}>Fechar</button>
              <button className="btn btn-primary" onClick={saveCustomType}><Save size={14} /> Adicionar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
