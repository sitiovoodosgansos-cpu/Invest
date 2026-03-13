import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { formatCurrency, getInitials, calculateProfitDistribution } from '../utils/helpers';
import { UserPlus, Trash2, Edit, Search, Mail, Phone, Users, Key, Eye, EyeOff } from 'lucide-react';

export default function Investors() {
  const { investors, birds, sales, addInvestor, updateInvestor, deleteInvestor } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', document: '', loginUsername: '', loginPassword: '' });
  const [showPassword, setShowPassword] = useState(false);

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds),
    [sales, birds]
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingId) {
      updateInvestor(editingId, form);
    } else {
      addInvestor(form);
    }
    setForm({ name: '', email: '', phone: '', document: '', loginUsername: '', loginPassword: '' });
    setEditingId(null);
    setShowModal(false);
    setShowPassword(false);
  };

  const handleEdit = (investor) => {
    setForm({ name: investor.name, email: investor.email || '', phone: investor.phone || '', document: investor.document || '', loginUsername: investor.loginUsername || '', loginPassword: investor.loginPassword || '' });
    setEditingId(investor.id);
    setShowModal(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Tem certeza que deseja remover este investidor? Todas as aves vinculadas também serão removidas.')) {
      deleteInvestor(id);
    }
  };

  const filtered = investors.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Investidores</h2>
        <p>Gerencie os investidores do Sitio Voo dos Gansos</p>
      </div>

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
        <button className="btn btn-primary" onClick={() => { setForm({ name: '', email: '', phone: '', document: '', loginUsername: '', loginPassword: '' }); setEditingId(null); setShowModal(true); setShowPassword(false); }}>
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
              {investor.loginUsername && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--primary)', marginBottom: 4 }}>
                  <Key size={12} /> Login: {investor.loginUsername}
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
              <div style={{ padding: '12px 16px', background: 'var(--primary-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Key size={16} color="var(--primary)" />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>Acesso do Investidor</span>
                </div>
                <div className="form-row">
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Login</label>
                    <input className="form-input" value={form.loginUsername} onChange={e => setForm({ ...form, loginUsername: e.target.value })} placeholder="usuario.login" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Senha</label>
                    <div style={{ position: 'relative' }}>
                      <input className="form-input" type={showPassword ? 'text' : 'password'} value={form.loginPassword} onChange={e => setForm({ ...form, loginPassword: e.target.value })} placeholder="Senha de acesso" style={{ paddingRight: 40 }} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', padding: 4 }}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                  O investidor usara esses dados para acessar o painel e acompanhar seus investimentos.
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Salvar' : 'Cadastrar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
