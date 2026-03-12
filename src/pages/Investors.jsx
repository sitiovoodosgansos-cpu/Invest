import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { formatCurrency, getInitials, calculateProfitDistribution } from '../utils/helpers';
import { UserPlus, Trash2, Edit, Search, Mail, Phone, Users, UserCheck, X as XIcon } from 'lucide-react';

export default function Investors() {
  const { investors, birds, sales, addInvestor, updateInvestor, deleteInvestor } = useApp();
  const { currentUser } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', document: '' });
  const [pendingUsers, setPendingUsers] = useState([]);
  const [approveModal, setApproveModal] = useState(null); // pending user being approved
  const [selectedInvestorId, setSelectedInvestorId] = useState('');

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds),
    [sales, birds]
  );

  // Listen for pending users
  useEffect(() => {
    const q = query(collection(db, 'users'), where('approved', '==', false));
    const unsub = onSnapshot(q, (snap) => {
      setPendingUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingId) {
      updateInvestor(editingId, form);
    } else {
      addInvestor(form);
    }
    setForm({ name: '', email: '', phone: '', document: '' });
    setEditingId(null);
    setShowModal(false);
  };

  const handleEdit = (investor) => {
    setForm({ name: investor.name, email: investor.email || '', phone: investor.phone || '', document: investor.document || '' });
    setEditingId(investor.id);
    setShowModal(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Tem certeza que deseja remover este investidor? Todas as aves vinculadas também serão removidas.')) {
      deleteInvestor(id);
    }
  };

  const handleApprove = async () => {
    if (!approveModal || !selectedInvestorId) return;
    try {
      await updateDoc(doc(db, 'users', approveModal.uid), {
        approved: true,
        investorId: selectedInvestorId,
        approvedAt: new Date().toISOString(),
        approvedBy: currentUser.uid,
      });
      setApproveModal(null);
      setSelectedInvestorId('');
    } catch (err) {
      console.error('Approve error:', err);
    }
  };

  const handleApproveNewInvestor = async () => {
    if (!approveModal) return;
    // Create a new investor record and link it
    const newInvestor = addInvestor({
      name: approveModal.displayName,
      email: approveModal.email,
      phone: '',
      document: '',
    });
    try {
      await updateDoc(doc(db, 'users', approveModal.uid), {
        approved: true,
        investorId: newInvestor.id,
        approvedAt: new Date().toISOString(),
        approvedBy: currentUser.uid,
      });
      setApproveModal(null);
      setSelectedInvestorId('');
    } catch (err) {
      console.error('Approve error:', err);
    }
  };

  const handleReject = async (user) => {
    if (!window.confirm(`Rejeitar a conta de ${user.displayName || user.email}?`)) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        rejected: true,
        approved: false,
      });
    } catch (err) {
      console.error('Reject error:', err);
    }
  };

  const filtered = investors.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase())
  );

  const activePending = pendingUsers.filter(u => !u.rejected);

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Investidores</h2>
        <p>Gerencie os investidores do Sitio Voo dos Gansos</p>
      </div>

      {/* Pending Users Section */}
      {activePending.length > 0 && (
        <div className="card" style={{ marginBottom: 24, border: '2px solid var(--warning-border, #ffc107)' }}>
          <div className="card-header" style={{ background: 'var(--warning-bg, #fff3cd)' }}>
            <span className="card-title" style={{ color: 'var(--warning-text, #856404)' }}>
              <UserCheck size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              Usuarios Pendentes ({activePending.length})
            </span>
          </div>
          <div style={{ padding: 16 }}>
            {activePending.map(user => (
              <div key={user.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <strong>{user.displayName || 'Sem nome'}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{user.email}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Registrado em {new Date(user.createdAt).toLocaleDateString('pt-BR')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => { setApproveModal(user); setSelectedInvestorId(''); }}
                  >
                    <UserCheck size={14} /> Aprovar
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleReject(user)}
                    style={{ color: 'var(--danger, #dc3545)' }}
                  >
                    Rejeitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="filter-bar">
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            style={{ paddingLeft: 36 }}
            placeholder="Buscar investidor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', email: '', phone: '', document: '' }); setEditingId(null); setShowModal(true); }}>
          <UserPlus size={16} /> Novo Investidor
        </button>
      </div>

      <div className="grid-3">
        {filtered.map(investor => {
          const investorBirds = birds.filter(b => b.investorId === investor.id);
          const totalMatrices = investorBirds.reduce((s, b) => s + (parseInt(b.matrixCount) || 0), 0);
          const totalBreeders = investorBirds.reduce((s, b) => s + (parseInt(b.breederCount) || 0), 0);
          const totalInvested = investorBirds.reduce((s, b) => s + (parseFloat(b.investmentValue) || 0), 0);
          const d = distribution.distribution[investor.id];
          const profit = d ? d.totalProfit : 0;

          return (
            <div className="investor-card" key={investor.id}>
              <div className="investor-card-header">
                <div className="investor-avatar">{getInitials(investor.name)}</div>
                <div className="investor-info" style={{ flex: 1 }}>
                  <h3>{investor.name}</h3>
                  <p>{investorBirds.length} especies no plantel</p>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn-icon edit" onClick={() => handleEdit(investor)} title="Editar">
                    <Edit size={16} />
                  </button>
                  <button className="btn-icon" onClick={() => handleDelete(investor.id)} title="Remover">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {investor.email && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  <Mail size={12} /> {investor.email}
                </div>
              )}
              {investor.phone && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  <Phone size={12} /> {investor.phone}
                </div>
              )}

              <div className="investor-stats">
                <div>
                  <div className="investor-stat-label">Matrizes</div>
                  <div className="investor-stat-value">{totalMatrices}</div>
                </div>
                <div>
                  <div className="investor-stat-label">Reprodutores</div>
                  <div className="investor-stat-value">{totalBreeders}</div>
                </div>
                <div>
                  <div className="investor-stat-label">Investido</div>
                  <div className="investor-stat-value" style={{ color: 'var(--primary)' }}>{formatCurrency(totalInvested)}</div>
                </div>
                <div>
                  <div className="investor-stat-label">Lucro</div>
                  <div className="investor-stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(profit)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <Users size={48} />
          <h3>Nenhum investidor cadastrado</h3>
          <p>Adicione o primeiro investidor para comecar</p>
        </div>
      )}

      {/* Add/Edit Investor Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{editingId ? 'Editar Investidor' : 'Novo Investidor'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Nome Completo *</label>
                <input className="form-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nome do investidor" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Telefone</label>
                  <input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(11) 99999-9999" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">CPF/CNPJ</label>
                <input className="form-input" value={form.document} onChange={e => setForm({ ...form, document: e.target.value })} placeholder="000.000.000-00" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Salvar' : 'Cadastrar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve User Modal */}
      {approveModal && (
        <div className="modal-overlay" onClick={() => setApproveModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Aprovar Usuario</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
              Aprovar <strong>{approveModal.displayName}</strong> ({approveModal.email}) como investidor.
            </p>

            <div className="form-group">
              <label className="form-label">Vincular a investidor existente</label>
              <select
                className="form-input"
                value={selectedInvestorId}
                onChange={e => setSelectedInvestorId(e.target.value)}
              >
                <option value="">Selecione um investidor...</option>
                {investors.map(inv => (
                  <option key={inv.id} value={inv.id}>{inv.name}</option>
                ))}
              </select>
            </div>

            <div className="modal-actions" style={{ flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setApproveModal(null)}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={!selectedInvestorId}
                  onClick={handleApprove}
                >
                  Vincular e Aprovar
                </button>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', background: 'var(--success)', borderColor: 'var(--success)' }}
                onClick={handleApproveNewInvestor}
              >
                <UserPlus size={14} /> Criar Novo Investidor e Aprovar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
