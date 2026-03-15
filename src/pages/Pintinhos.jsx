import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { formatDate } from '../utils/helpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  Plus, Trash2, Edit2, Save, X, ChevronDown, ChevronUp,
  Home, Baby, Skull, Pill, Calendar, TrendingUp, AlertTriangle, RefreshCw, Layers
} from 'lucide-react';

const MONTH_NAMES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const ROOM_SPECIES = ['Galinhas', 'Marrecos', 'Pavões', 'Faisões', 'Mista'];

const BATCH_STATUS = {
  active: { label: 'Ativa', color: '#f59e0b', bg: '#fef3c7' },
  graduated: { label: 'Formada', color: '#10b981', bg: '#d1fae5' },
  sold: { label: 'Vendida', color: '#3b82f6', bg: '#dbeafe' },
  closed: { label: 'Encerrada', color: '#6b7280', bg: '#f3f4f6' },
};

const EVENT_TYPES = {
  death: { label: 'Óbito', color: '#ef4444', icon: Skull },
  medication: { label: 'Medicação', color: '#6C2BD9', icon: Pill },
  vaccination: { label: 'Vacinação', color: '#3b82f6', icon: Calendar },
  bedding: { label: 'Troca de Cama', color: '#f59e0b', icon: RefreshCw },
  transfer: { label: 'Transferência', color: '#10b981', icon: TrendingUp },
  sale: { label: 'Venda', color: '#ec4899', icon: Layers },
  observation: { label: 'Observação', color: '#6b7280', icon: AlertTriangle },
};

export default function Pintinhos() {
  const {
    birds, incubators, incubatorBatches,
    nurseryRooms, nurseryBatches, nurseryEvents,
    addNurseryRoom, updateNurseryRoom, deleteNurseryRoom,
    addNurseryBatch, updateNurseryBatch, deleteNurseryBatch,
    addNurseryEvent, updateNurseryEvent, deleteNurseryEvent,
  } = useApp();

  const allRooms = nurseryRooms || [];
  const allBatches = nurseryBatches || [];
  const allEvents = nurseryEvents || [];
  const allIncubators = incubators || [];
  const allIncBatches = (incubatorBatches || []).filter(b => b.status === 'hatched');

  // Tab state
  const [activeTab, setActiveTab] = useState('rooms');
  const [expandedRoom, setExpandedRoom] = useState(null);
  const [expandedBatch, setExpandedBatch] = useState(null);

  // Room modal
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [roomForm, setRoomForm] = useState({ name: '', species: 'Galinhas', capacity: '', notes: '' });

  // Batch modal
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const [batchForm, setBatchForm] = useState({
    roomId: '', incubatorBatchId: '', dateIn: '', quantityIn: '',
    status: 'active', dateOut: '', quantityOut: '', notes: '',
  });

  // Event modal
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [eventForm, setEventForm] = useState({
    batchId: '', roomId: '', type: 'death', date: '', quantity: '',
    cause: '', product: '', dosage: '', notes: '',
  });

  // ── Helpers ──
  const getIncubatorBatchLabel = (incBatchId) => {
    const batch = allIncBatches.find(b => b.id === incBatchId);
    if (!batch) return 'Lote não encontrado';
    const inc = allIncubators.find(i => i.id === batch.incubatorId);
    return `${inc?.name || 'Chocadeira'} - ${formatDate(batch.dateHatch)} (${batch.totalHatched} nasc.)`;
  };

  const getBatchDeaths = (batchId) => {
    return allEvents
      .filter(e => e.batchId === batchId && e.type === 'death')
      .reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
  };

  const getBatchSales = (batchId) => {
    return allEvents
      .filter(e => e.batchId === batchId && e.type === 'sale')
      .reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
  };

  const getBatchTransfers = (batchId) => {
    return allEvents
      .filter(e => e.batchId === batchId && e.type === 'transfer')
      .reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
  };

  const getBatchCurrentCount = (batch) => {
    const entered = parseInt(batch.quantityIn) || 0;
    const deaths = getBatchDeaths(batch.id);
    const sales = getBatchSales(batch.id);
    const transfers = getBatchTransfers(batch.id);
    return entered - deaths - sales - transfers;
  };

  const getBatchSurvivalRate = (batch) => {
    const entered = parseInt(batch.quantityIn) || 0;
    if (entered === 0) return 0;
    const deaths = getBatchDeaths(batch.id);
    return Math.round(((entered - deaths) / entered) * 100);
  };

  const getBatchAgeWeeks = (batch) => {
    if (!batch.dateIn) return 0;
    const now = new Date();
    const start = new Date(batch.dateIn);
    return Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000));
  };

  const getRoomBatches = (roomId) => allBatches.filter(b => b.roomId === roomId);
  const getRoomEvents = (roomId) => allEvents.filter(e => e.roomId === roomId);

  // ── Stats ──
  const stats = useMemo(() => {
    const activeBatches = allBatches.filter(b => b.status === 'active');
    const totalChicksNow = activeBatches.reduce((s, b) => s + getBatchCurrentCount(b), 0);
    const totalEntered = allBatches.reduce((s, b) => s + (parseInt(b.quantityIn) || 0), 0);
    const totalDeaths = allEvents.filter(e => e.type === 'death').reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
    const totalSales = allEvents.filter(e => e.type === 'sale').reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
    const graduated = allBatches.filter(b => b.status === 'graduated');
    const totalGraduated = graduated.reduce((s, b) => s + (parseInt(b.quantityOut) || 0), 0);
    const overallSurvival = totalEntered > 0 ? Math.round(((totalEntered - totalDeaths) / totalEntered) * 100) : 0;

    // Monthly deaths chart
    const now = new Date();
    const monthlyDeaths = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const deaths = allEvents
        .filter(e => e.type === 'death' && e.date && e.date.startsWith(key))
        .reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
      const meds = allEvents
        .filter(e => e.type === 'medication' && e.date && e.date.startsWith(key)).length;
      monthlyDeaths.push({ month: `${MONTH_NAMES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, obitos: deaths, medicacoes: meds });
    }

    // Per-room survival
    const roomSurvival = allRooms.map(room => {
      const batches = getRoomBatches(room.id);
      const entered = batches.reduce((s, b) => s + (parseInt(b.quantityIn) || 0), 0);
      const deaths = getRoomEvents(room.id).filter(e => e.type === 'death').reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
      const rate = entered > 0 ? Math.round(((entered - deaths) / entered) * 100) : 0;
      return { name: room.name, taxa: rate, entered, deaths };
    }).filter(r => r.entered > 0);

    return {
      activeBatchCount: activeBatches.length,
      totalChicksNow,
      totalEntered,
      totalDeaths,
      totalSales,
      totalGraduated,
      overallSurvival,
      monthlyDeaths,
      roomSurvival,
    };
  }, [allBatches, allEvents, allRooms]);

  // ── Room handlers ──
  function openRoomModal(room) {
    if (room) {
      setEditingRoom(room);
      setRoomForm({ name: room.name, species: room.species || 'Galinhas', capacity: room.capacity || '', notes: room.notes || '' });
    } else {
      setEditingRoom(null);
      setRoomForm({ name: '', species: 'Galinhas', capacity: '', notes: '' });
    }
    setShowRoomModal(true);
  }

  function saveRoom() {
    if (!roomForm.name.trim()) return;
    const data = { name: roomForm.name.trim(), species: roomForm.species, capacity: Number(roomForm.capacity) || 0, notes: roomForm.notes.trim() };
    if (editingRoom) updateNurseryRoom(editingRoom.id, data);
    else addNurseryRoom(data);
    setShowRoomModal(false);
  }

  function removeRoom(id) {
    if (confirm('Excluir esta sala e todos os lotes e eventos associados?')) deleteNurseryRoom(id);
  }

  // ── Batch handlers ──
  function openBatchModal(roomId, batch) {
    if (batch) {
      setEditingBatch(batch);
      setBatchForm({
        roomId: batch.roomId, incubatorBatchId: batch.incubatorBatchId || '',
        dateIn: batch.dateIn || '', quantityIn: batch.quantityIn || '',
        status: batch.status || 'active', dateOut: batch.dateOut || '',
        quantityOut: batch.quantityOut || '', notes: batch.notes || '',
      });
    } else {
      setEditingBatch(null);
      setBatchForm({
        roomId: roomId || '', incubatorBatchId: '', dateIn: new Date().toISOString().slice(0, 10),
        quantityIn: '', status: 'active', dateOut: '', quantityOut: '', notes: '',
      });
    }
    setShowBatchModal(true);
  }

  function saveBatch() {
    if (!batchForm.roomId || !batchForm.quantityIn) return;
    const data = { ...batchForm, quantityIn: parseInt(batchForm.quantityIn) || 0 };
    if (data.quantityOut) data.quantityOut = parseInt(data.quantityOut) || 0;
    if (editingBatch) updateNurseryBatch(editingBatch.id, data);
    else addNurseryBatch(data);
    setShowBatchModal(false);
  }

  function removeBatch(id) {
    if (confirm('Excluir este lote?')) deleteNurseryBatch(id);
  }

  // ── Event handlers ──
  function openEventModal(batch, event) {
    if (event) {
      setEditingEvent(event);
      setEventForm({
        batchId: event.batchId, roomId: event.roomId, type: event.type || 'death',
        date: event.date || '', quantity: event.quantity || '', cause: event.cause || '',
        product: event.product || '', dosage: event.dosage || '', notes: event.notes || '',
      });
    } else {
      setEditingEvent(null);
      setEventForm({
        batchId: batch?.id || '', roomId: batch?.roomId || '', type: 'death',
        date: new Date().toISOString().slice(0, 10), quantity: '', cause: '',
        product: '', dosage: '', notes: '',
      });
    }
    setShowEventModal(true);
  }

  function saveEvent() {
    if (!eventForm.batchId || !eventForm.date) return;
    const data = { ...eventForm };
    if (data.quantity) data.quantity = parseInt(data.quantity) || 0;
    if (editingEvent) updateNurseryEvent(editingEvent.id, data);
    else addNurseryEvent(data);
    setShowEventModal(false);
  }

  function removeEvent(id) {
    if (confirm('Excluir este registro?')) deleteNurseryEvent(id);
  }

  // ── Medication schedule for current week ──
  const weekSchedule = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + i);
      const dateStr = day.toISOString().slice(0, 10);
      const dayEvents = allEvents.filter(e => e.date === dateStr && (e.type === 'medication' || e.type === 'vaccination'));
      days.push({ date: dateStr, dayName: DAY_NAMES[i], events: dayEvents });
    }
    return days;
  }, [allEvents]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Pintinhos</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            Controle de salas de criação, crescimento e sobrevivência dos filhotes
          </p>
        </div>
      </div>

      {/* ── Stats Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <Baby size={20} style={{ color: '#f59e0b', marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: '#f59e0b' }}>{stats.totalChicksNow}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Pintinhos Ativos</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <Home size={20} style={{ color: '#3b82f6', marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: '#3b82f6' }}>{stats.activeBatchCount}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Lotes Ativos</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <Skull size={20} style={{ color: '#ef4444', marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{stats.totalDeaths}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Óbitos Total</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <TrendingUp size={20} style={{ color: '#10b981', marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981' }}>{stats.overallSurvival}%</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Sobrevivência</div>
        </div>
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <Layers size={20} style={{ color: '#6C2BD9', marginBottom: 4 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: '#6C2BD9' }}>{stats.totalGraduated}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Formados (Adulto)</div>
        </div>
      </div>

      {/* ── Charts ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ marginBottom: 12, fontSize: 14 }}>Óbitos e Medicações por Mês</h4>
          {stats.monthlyDeaths.some(d => d.obitos > 0 || d.medicacoes > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.monthlyDeaths}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="obitos" name="Óbitos" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="medicacoes" name="Medicações" fill="#6C2BD9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              Sem dados registrados
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ marginBottom: 12, fontSize: 14 }}>Taxa de Sobrevivência por Sala</h4>
          {stats.roomSurvival.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.roomSurvival} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip formatter={(v) => `${v}%`} />
                <Bar dataKey="taxa" name="Sobrevivência" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              Sem dados de salas
            </div>
          )}
        </div>
      </div>

      {/* ── Weekly medication schedule ── */}
      {allEvents.some(e => e.type === 'medication' || e.type === 'vaccination') && (
        <div className="card" style={{ padding: 16, marginBottom: 24 }}>
          <h4 style={{ marginBottom: 12, fontSize: 14 }}>Calendário da Semana (Medicações e Vacinações)</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {weekSchedule.map(day => (
              <div key={day.date} style={{
                padding: 8, borderRadius: 8, border: '1px solid var(--border)',
                background: day.date === new Date().toISOString().slice(0, 10) ? '#eff6ff' : 'var(--bg-primary)',
                minHeight: 80,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>
                  {day.dayName} {day.date.slice(8, 10)}/{day.date.slice(5, 7)}
                </div>
                {day.events.length === 0 ? (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>-</div>
                ) : (
                  day.events.map(ev => {
                    const evType = EVENT_TYPES[ev.type];
                    return (
                      <div key={ev.id} style={{ fontSize: 10, padding: '2px 4px', borderRadius: 4, marginBottom: 2, background: ev.type === 'vaccination' ? '#dbeafe' : '#f3e8ff', color: evType?.color }}>
                        {ev.product || evType?.label}
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'rooms', label: 'Salas de Criação', icon: <Home size={14} /> },
          { key: 'batches', label: 'Todos os Lotes', icon: <Baby size={14} /> },
          { key: 'timeline', label: 'Linha do Tempo', icon: <Calendar size={14} /> },
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

      {/* ════════ TAB: Salas de Criação ════════ */}
      {activeTab === 'rooms' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16 }}>Salas de Criação ({allRooms.length})</h3>
            <button className="btn btn-primary" onClick={() => openRoomModal(null)}>
              <Plus size={16} /> Nova Sala
            </button>
          </div>

          {allRooms.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Nenhuma sala de criação cadastrada. Clique em "Nova Sala" para começar.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {allRooms.map(room => {
                const roomBatches = getRoomBatches(room.id);
                const activeBatches = roomBatches.filter(b => b.status === 'active');
                const roomDeaths = getRoomEvents(room.id).filter(e => e.type === 'death').reduce((s, e) => s + (parseInt(e.quantity) || 0), 0);
                const totalIn = roomBatches.reduce((s, b) => s + (parseInt(b.quantityIn) || 0), 0);
                const currentInRoom = activeBatches.reduce((s, b) => s + getBatchCurrentCount(b), 0);
                const isExpanded = expandedRoom === room.id;

                return (
                  <div key={room.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* Room header */}
                    <div
                      style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: isExpanded ? 'var(--bg-secondary)' : 'transparent' }}
                      onClick={() => setExpandedRoom(isExpanded ? null : room.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>
                            {room.name}
                            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                              ({room.species})
                            </span>
                          </div>
                          {room.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{room.notes}</div>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#fef3c7', color: '#92400e' }}>
                          {currentInRoom} pintinhos
                        </span>
                        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#dbeafe', color: '#1d4ed8' }}>
                          {activeBatches.length} lotes
                        </span>
                        {roomDeaths > 0 && (
                          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#fee2e2', color: '#991b1b' }}>
                            {roomDeaths} óbitos
                          </span>
                        )}
                        {room.capacity > 0 && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cap: {room.capacity}</span>
                        )}
                        <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); openRoomModal(room); }}>
                          <Edit2 size={12} />
                        </button>
                        <button className="btn btn-sm btn-secondary" style={{ color: '#ef4444' }} onClick={(e) => { e.stopPropagation(); removeRoom(room.id); }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded: batches inside room */}
                    {isExpanded && (
                      <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>Lotes nesta sala ({roomBatches.length})</span>
                          <button className="btn btn-sm btn-primary" onClick={() => openBatchModal(room.id, null)}>
                            <Plus size={12} /> Novo Lote
                          </button>
                        </div>

                        {roomBatches.length === 0 ? (
                          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
                            Nenhum lote nesta sala.
                          </p>
                        ) : (
                          <div style={{ display: 'grid', gap: 8 }}>
                            {roomBatches.sort((a, b) => (b.dateIn || '').localeCompare(a.dateIn || '')).map(batch => {
                              const statusInfo = BATCH_STATUS[batch.status] || BATCH_STATUS.active;
                              const deaths = getBatchDeaths(batch.id);
                              const sales = getBatchSales(batch.id);
                              const currentCount = getBatchCurrentCount(batch);
                              const survivalRate = getBatchSurvivalRate(batch);
                              const ageWeeks = getBatchAgeWeeks(batch);
                              const batchEvents = allEvents.filter(e => e.batchId === batch.id);
                              const isBatchExpanded = expandedBatch === batch.id;

                              return (
                                <div key={batch.id} style={{ padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: 200 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: statusInfo.bg, color: statusInfo.color, fontWeight: 600 }}>
                                          {statusInfo.label}
                                        </span>
                                        {batch.incubatorBatchId && (
                                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                            Lote: {getIncubatorBatchLabel(batch.incubatorBatchId)}
                                          </span>
                                        )}
                                      </div>
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginTop: 8 }}>
                                        <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Entraram</div>
                                          <div style={{ fontSize: 16, fontWeight: 700 }}>{batch.quantityIn || 0}</div>
                                        </div>
                                        <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Atuais</div>
                                          <div style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>{currentCount}</div>
                                        </div>
                                        <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Óbitos</div>
                                          <div style={{ fontSize: 16, fontWeight: 700, color: '#ef4444' }}>{deaths}</div>
                                        </div>
                                        <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Sobrev.</div>
                                          <div style={{ fontSize: 16, fontWeight: 700, color: survivalRate >= 80 ? '#10b981' : survivalRate >= 60 ? '#f59e0b' : '#ef4444' }}>{survivalRate}%</div>
                                        </div>
                                        {ageWeeks > 0 && (
                                          <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Idade</div>
                                            <div style={{ fontSize: 16, fontWeight: 700 }}>{ageWeeks}sem</div>
                                          </div>
                                        )}
                                        {sales > 0 && (
                                          <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Vendas</div>
                                            <div style={{ fontSize: 16, fontWeight: 700, color: '#ec4899' }}>{sales}</div>
                                          </div>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                                        Entrada: {formatDate(batch.dateIn)}
                                        {batch.dateOut && <span> | Saída: {formatDate(batch.dateOut)}</span>}
                                      </div>
                                      {batch.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>{batch.notes}</div>}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <button className="btn btn-sm btn-primary" onClick={() => openEventModal(batch, null)}>
                                        <Plus size={11} /> Evento
                                      </button>
                                      <button className="btn btn-sm btn-secondary" onClick={() => openBatchModal(room.id, batch)}>
                                        <Edit2 size={11} />
                                      </button>
                                      <button className="btn btn-sm btn-secondary" onClick={() => setExpandedBatch(isBatchExpanded ? null : batch.id)}>
                                        {isBatchExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />} Histórico
                                      </button>
                                      <button className="btn btn-sm btn-secondary" style={{ color: '#ef4444' }} onClick={() => removeBatch(batch.id)}>
                                        <Trash2 size={11} />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Batch events timeline */}
                                  {isBatchExpanded && (
                                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                                      <span style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'block' }}>
                                        Histórico de Eventos ({batchEvents.length})
                                      </span>
                                      {batchEvents.length === 0 ? (
                                        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum evento registrado.</p>
                                      ) : (
                                        <div style={{ display: 'grid', gap: 4 }}>
                                          {batchEvents.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(ev => {
                                            const evType = EVENT_TYPES[ev.type] || EVENT_TYPES.observation;
                                            const Icon = evType.icon;
                                            return (
                                              <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 6, background: 'var(--bg-secondary)', fontSize: 12 }}>
                                                <Icon size={12} style={{ color: evType.color, flexShrink: 0 }} />
                                                <span style={{ fontWeight: 500, color: evType.color, minWidth: 80 }}>{evType.label}</span>
                                                <span style={{ color: 'var(--text-muted)', minWidth: 70 }}>{formatDate(ev.date)}</span>
                                                {ev.quantity && <span style={{ fontWeight: 600 }}>Qtd: {ev.quantity}</span>}
                                                {ev.cause && <span style={{ color: 'var(--text-secondary)' }}>- {ev.cause}</span>}
                                                {ev.product && <span style={{ color: 'var(--text-secondary)' }}>- {ev.product}</span>}
                                                {ev.notes && <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>({ev.notes})</span>}
                                                <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                                                  <button className="btn btn-sm btn-secondary" style={{ padding: '2px 4px' }} onClick={() => openEventModal(batch, ev)}><Edit2 size={10} /></button>
                                                  <button className="btn btn-sm btn-secondary" style={{ padding: '2px 4px', color: '#ef4444' }} onClick={() => removeEvent(ev.id)}><Trash2 size={10} /></button>
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════ TAB: Todos os Lotes ════════ */}
      {activeTab === 'batches' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16 }}>Todos os Lotes ({allBatches.length})</h3>
          </div>

          {allBatches.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Nenhum lote registrado. Adicione lotes nas salas de criação.
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Sala</th>
                    <th>Lote (Chocadeira)</th>
                    <th>Entrada</th>
                    <th>Entraram</th>
                    <th>Atuais</th>
                    <th>Óbitos</th>
                    <th>Vendas</th>
                    <th>Sobrev.</th>
                    <th>Idade</th>
                    <th>Status</th>
                    <th style={{ width: 80 }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {[...allBatches].sort((a, b) => (b.dateIn || '').localeCompare(a.dateIn || '')).map(batch => {
                    const room = allRooms.find(r => r.id === batch.roomId);
                    const statusInfo = BATCH_STATUS[batch.status] || BATCH_STATUS.active;
                    const deaths = getBatchDeaths(batch.id);
                    const sales = getBatchSales(batch.id);
                    const currentCount = getBatchCurrentCount(batch);
                    const survivalRate = getBatchSurvivalRate(batch);
                    const ageWeeks = getBatchAgeWeeks(batch);
                    return (
                      <tr key={batch.id}>
                        <td><strong>{room?.name || 'Sala removida'}</strong></td>
                        <td style={{ fontSize: 11 }}>{batch.incubatorBatchId ? getIncubatorBatchLabel(batch.incubatorBatchId) : '-'}</td>
                        <td>{formatDate(batch.dateIn)}</td>
                        <td style={{ fontWeight: 600 }}>{batch.quantityIn}</td>
                        <td style={{ fontWeight: 600, color: '#f59e0b' }}>{currentCount}</td>
                        <td style={{ fontWeight: 600, color: deaths > 0 ? '#ef4444' : 'var(--text-muted)' }}>{deaths}</td>
                        <td style={{ fontWeight: 600, color: sales > 0 ? '#ec4899' : 'var(--text-muted)' }}>{sales}</td>
                        <td style={{ fontWeight: 600, color: survivalRate >= 80 ? '#10b981' : survivalRate >= 60 ? '#f59e0b' : '#ef4444' }}>{survivalRate}%</td>
                        <td>{ageWeeks}sem</td>
                        <td>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: statusInfo.bg, color: statusInfo.color, fontWeight: 600 }}>
                            {statusInfo.label}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-secondary" onClick={() => openBatchModal(batch.roomId, batch)}><Edit2 size={12} /></button>
                            <button className="btn btn-sm btn-secondary" style={{ color: '#ef4444' }} onClick={() => removeBatch(batch.id)}><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ════════ TAB: Linha do Tempo ════════ */}
      {activeTab === 'timeline' && (
        <div>
          <h3 style={{ fontSize: 16, marginBottom: 16 }}>Linha do Tempo - Últimos Eventos</h3>
          {allEvents.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Nenhum evento registrado ainda.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {[...allEvents].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 100).map(ev => {
                const evType = EVENT_TYPES[ev.type] || EVENT_TYPES.observation;
                const Icon = evType.icon;
                const room = allRooms.find(r => r.id === ev.roomId);
                const batch = allBatches.find(b => b.id === ev.batchId);
                return (
                  <div key={ev.id} className="card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${evType.color}20`, flexShrink: 0 }}>
                      <Icon size={16} style={{ color: evType.color }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: evType.color }}>{evType.label}</span>
                        {ev.quantity && <span style={{ fontSize: 12, fontWeight: 600 }}>Qtd: {ev.quantity}</span>}
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(ev.date)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {room?.name || 'Sala removida'}
                        {ev.cause && ` - ${ev.cause}`}
                        {ev.product && ` - ${ev.product}`}
                        {ev.dosage && ` (${ev.dosage})`}
                        {ev.notes && ` - ${ev.notes}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => openEventModal(batch, ev)}><Edit2 size={11} /></button>
                      <button className="btn btn-sm btn-secondary" style={{ color: '#ef4444' }} onClick={() => removeEvent(ev.id)}><Trash2 size={11} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════ MODAL: Room ════════ */}
      {showRoomModal && (
        <div className="modal-overlay" onClick={() => setShowRoomModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h3>{editingRoom ? 'Editar Sala' : 'Nova Sala de Criação'}</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowRoomModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Nome da Sala *</label>
                <input className="form-input" value={roomForm.name} onChange={e => setRoomForm({ ...roomForm, name: e.target.value })} placeholder="Ex: Sala Pintinhos 1" />
              </div>
              <div className="form-group">
                <label>Espécie</label>
                <select className="form-input" value={roomForm.species} onChange={e => setRoomForm({ ...roomForm, species: e.target.value })}>
                  {ROOM_SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Capacidade</label>
                <input className="form-input" type="number" value={roomForm.capacity} onChange={e => setRoomForm({ ...roomForm, capacity: e.target.value })} placeholder="Número de pintinhos" />
              </div>
              <div className="form-group">
                <label>Observações</label>
                <textarea className="form-input" rows={3} value={roomForm.notes} onChange={e => setRoomForm({ ...roomForm, notes: e.target.value })} placeholder="Notas sobre esta sala..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowRoomModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveRoom}><Save size={14} /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ MODAL: Batch ════════ */}
      {showBatchModal && (
        <div className="modal-overlay" onClick={() => setShowBatchModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3>{editingBatch ? 'Editar Lote' : 'Novo Lote de Pintinhos'}</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowBatchModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Sala *</label>
                <select className="form-input" value={batchForm.roomId} onChange={e => setBatchForm({ ...batchForm, roomId: e.target.value })}>
                  <option value="">Selecione a sala</option>
                  {allRooms.map(r => <option key={r.id} value={r.id}>{r.name} ({r.species})</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Lote da Chocadeira (opcional)</label>
                <select className="form-input" value={batchForm.incubatorBatchId} onChange={e => {
                  const selBatch = allIncBatches.find(b => b.id === e.target.value);
                  setBatchForm({
                    ...batchForm,
                    incubatorBatchId: e.target.value,
                    quantityIn: selBatch ? String(selBatch.totalHatched || '') : batchForm.quantityIn,
                  });
                }}>
                  <option value="">Sem vínculo com chocadeira</option>
                  {allIncBatches.map(b => {
                    const inc = allIncubators.find(i => i.id === b.incubatorId);
                    return <option key={b.id} value={b.id}>{inc?.name || 'Chocadeira'} - {formatDate(b.dateHatch)} ({b.totalHatched} nasc.)</option>;
                  })}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Quantidade Entrando *</label>
                  <input className="form-input" type="number" min="1" value={batchForm.quantityIn} onChange={e => setBatchForm({ ...batchForm, quantityIn: e.target.value })} placeholder="Pintinhos" />
                </div>
                <div className="form-group">
                  <label>Data Entrada *</label>
                  <input className="form-input" type="date" value={batchForm.dateIn} onChange={e => setBatchForm({ ...batchForm, dateIn: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Status</label>
                  <select className="form-input" value={batchForm.status} onChange={e => setBatchForm({ ...batchForm, status: e.target.value })}>
                    {Object.entries(BATCH_STATUS).map(([key, val]) => (
                      <option key={key} value={key}>{val.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Qtd Saída (se formado)</label>
                  <input className="form-input" type="number" min="0" value={batchForm.quantityOut} onChange={e => setBatchForm({ ...batchForm, quantityOut: e.target.value })} placeholder="Qtd que saíram vivos" />
                </div>
              </div>
              {(batchForm.status === 'graduated' || batchForm.status === 'sold' || batchForm.status === 'closed') && (
                <div className="form-group">
                  <label>Data Saída</label>
                  <input className="form-input" type="date" value={batchForm.dateOut} onChange={e => setBatchForm({ ...batchForm, dateOut: e.target.value })} />
                </div>
              )}
              <div className="form-group">
                <label>Observações</label>
                <textarea className="form-input" rows={2} value={batchForm.notes} onChange={e => setBatchForm({ ...batchForm, notes: e.target.value })} placeholder="Notas sobre este lote..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBatchModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveBatch}><Save size={14} /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ MODAL: Event ════════ */}
      {showEventModal && (
        <div className="modal-overlay" onClick={() => setShowEventModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h3>{editingEvent ? 'Editar Evento' : 'Novo Evento'}</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowEventModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Lote *</label>
                <select className="form-input" value={eventForm.batchId} onChange={e => {
                  const batch = allBatches.find(b => b.id === e.target.value);
                  setEventForm({ ...eventForm, batchId: e.target.value, roomId: batch?.roomId || eventForm.roomId });
                }}>
                  <option value="">Selecione o lote</option>
                  {allBatches.filter(b => b.status === 'active').map(b => {
                    const room = allRooms.find(r => r.id === b.roomId);
                    return <option key={b.id} value={b.id}>{room?.name || 'Sala'} - {formatDate(b.dateIn)} ({getBatchCurrentCount(b)} atuais)</option>;
                  })}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label>Tipo de Evento *</label>
                  <select className="form-input" value={eventForm.type} onChange={e => setEventForm({ ...eventForm, type: e.target.value })}>
                    {Object.entries(EVENT_TYPES).map(([key, val]) => (
                      <option key={key} value={key}>{val.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Data *</label>
                  <input className="form-input" type="date" value={eventForm.date} onChange={e => setEventForm({ ...eventForm, date: e.target.value })} />
                </div>
              </div>

              {(eventForm.type === 'death' || eventForm.type === 'sale' || eventForm.type === 'transfer') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label>Quantidade</label>
                    <input className="form-input" type="number" min="1" value={eventForm.quantity} onChange={e => setEventForm({ ...eventForm, quantity: e.target.value })} placeholder="Nº de aves" />
                  </div>
                  <div className="form-group">
                    <label>{eventForm.type === 'death' ? 'Causa' : 'Destino'}</label>
                    <input className="form-input" value={eventForm.cause} onChange={e => setEventForm({ ...eventForm, cause: e.target.value })} placeholder={eventForm.type === 'death' ? 'Ex: Doença, aglomeração...' : 'Ex: Outra sala, cliente...'} />
                  </div>
                </div>
              )}

              {(eventForm.type === 'medication' || eventForm.type === 'vaccination') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label>Produto</label>
                    <input className="form-input" value={eventForm.product} onChange={e => setEventForm({ ...eventForm, product: e.target.value })} placeholder="Nome do medicamento/vacina" />
                  </div>
                  <div className="form-group">
                    <label>Dosagem</label>
                    <input className="form-input" value={eventForm.dosage} onChange={e => setEventForm({ ...eventForm, dosage: e.target.value })} placeholder="Ex: 1ml/L água" />
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Observações</label>
                <textarea className="form-input" rows={2} value={eventForm.notes} onChange={e => setEventForm({ ...eventForm, notes: e.target.value })} placeholder="Observações adicionais..." />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowEventModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveEvent}><Save size={14} /> Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
