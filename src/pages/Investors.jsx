import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { formatCurrency, getInitials, calculateProfitDistribution } from '../utils/helpers';
import { hashPassword } from '../utils/crypto';
import { UserPlus, Trash2, Edit, Search, Mail, Phone, Users, Key, Eye, EyeOff, Link, Check, XCircle } from 'lucide-react';
import Portal from '../components/Portal';

export default function Investors() {
  const {
    investors, birds, sales,
    addInvestor, updateInvestor, deleteInvestor,
    generateInvestorPortalToken, revokeInvestorPortalToken,
  } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  // loginPassword in the form is always the plaintext value the admin just typed.
  // On save we hash it before persisting. On edit we never pre-fill the field
  // (since we only store the hash) — an empty value means "keep the existing password".
  const [form, setForm] = useState({ name: '', email: '', phone: '', document: '', loginUsername: '', loginPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  // Track which investor is currently waiting on a generate/revoke round-trip.
  // Used to disable the button while the Firestore write is in flight so the
  // admin can't double-click and create orphaned tokens.
  const [pendingTokenId, setPendingTokenId] = useState(null);

  const buildPortalLink = (token) => {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}#/portal/${token}`;
  };

  const copyPortalLink = (token, investorId) => {
    if (!token) return;
    navigator.clipboard.writeText(buildPortalLink(token)).then(() => {
      setCopiedId(investorId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleGeneratePortalToken = async (investorId) => {
    if (pendingTokenId) return;
    setPendingTokenId(investorId);
    try {
      await generateInvestorPortalToken(investorId);
    } catch {
      window.alert('Nao foi possivel gerar o link. Verifique sua conexao e tente novamente.');
    } finally {
      setPendingTokenId(null);
    }
  };

  const handleRevokePortalToken = async (investorId) => {
    if (pendingTokenId) return;
    if (!window.confirm('Revogar o link deste investidor? O link atual deixara de funcionar imediatamente.')) {
      return;
    }
    setPendingTokenId(investorId);
    try {
      await revokeInvestorPortalToken(investorId);
    } catch {
      window.alert('Nao foi possivel revogar o link. Tente novamente.');
    } finally {
      setPendingTokenId(null);
    }
  };

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds),
    [sales, birds]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Hash any newly-typed plaintext password before persisting. Empty string
    // on edit means "keep the existing password" and we strip the field.
    const { loginPassword, ...rest } = form;
    const payload = { ...rest };
    const typedPassword = (loginPassword || '').trim();
    if (typedPassword) {
      try {
        payload.loginPassword = await hashPassword(typedPassword);
      } catch {
        // If hashing fails for any reason, fail closed: do not save plaintext.
        return;
      }
    } else if (!editingId) {
      // New investor with no password: persist empty string for consistency.
      payload.loginPassword = '';
    }
    if (editingId) {
      updateInvestor(editingId, payload);
    } else {
      addInvestor(payload);
    }
    setForm({ name: '', email: '', phone: '', document: '', loginUsername: '', loginPassword: '' });
    setEditingId(null);
    setShowModal(false);
    setShowPassword(false);
  };

  const handleEdit = (investor) => {
    // Never pre-fill loginPassword on edit: we only have the hash, and we do
    // not want the admin to accidentally overwrite it with the hash string.
    setForm({
      name: investor.name,
      email: investor.email || '',
      phone: investor.phone || '',
      document: investor.document || '',
      loginUsername: investor.loginUsername || '',
      loginPassword: '',
    });
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

              {investor.portalTokenId ? (
                <div style={{ marginTop: 12 }}>
                  <button
                    onClick={() => copyPortalLink(investor.portalTokenId, investor.id)}
                    disabled={pendingTokenId === investor.id}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      border: copiedId === investor.id ? '2px solid var(--success)' : '2px solid var(--primary)',
                      borderRadius: 'var(--radius-sm)',
                      background: copiedId === investor.id ? 'var(--success-bg)' : 'var(--primary-bg)',
                      color: copiedId === investor.id ? 'var(--success)' : 'var(--primary)',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {copiedId === investor.id ? <Check size={16} /> : <Link size={16} />}
                    {copiedId === investor.id ? 'Link copiado!' : 'Copiar link do relatorio'}
                  </button>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 6 }}>
                    <button
                      onClick={() => handleGeneratePortalToken(investor.id)}
                      disabled={pendingTokenId === investor.id}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        fontSize: 11,
                        cursor: pendingTokenId === investor.id ? 'wait' : 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Renovar link
                    </button>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>|</span>
                    <button
                      onClick={() => handleRevokePortalToken(investor.id)}
                      disabled={pendingTokenId === investor.id}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--danger)',
                        fontSize: 11,
                        cursor: pendingTokenId === investor.id ? 'wait' : 'pointer',
                        textDecoration: 'underline',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <XCircle size={11} /> Revogar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => handleGeneratePortalToken(investor.id)}
                  disabled={pendingTokenId === investor.id}
                  style={{
                    width: '100%',
                    marginTop: 12,
                    padding: '10px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    border: '2px dashed var(--primary)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--primary-bg)',
                    color: 'var(--primary)',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: pendingTokenId === investor.id ? 'wait' : 'pointer',
                    opacity: pendingTokenId === investor.id ? 0.6 : 1,
                    transition: 'all 0.2s',
                  }}
                >
                  <Link size={16} />
                  {pendingTokenId === investor.id ? 'Gerando...' : 'Gerar link do relatorio'}
                </button>
              )}
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
        <Portal><div className="modal-overlay" onClick={() => setShowModal(false)}>
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
                      <input
                        className="form-input"
                        type={showPassword ? 'text' : 'password'}
                        value={form.loginPassword}
                        onChange={e => setForm({ ...form, loginPassword: e.target.value })}
                        placeholder={editingId ? 'Deixe em branco para manter' : 'Senha de acesso'}
                        autoComplete="new-password"
                        style={{ paddingRight: 40 }}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', padding: 4 }}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                  O investidor usara esses dados para acessar o painel e acompanhar seus investimentos.
                  {editingId && ' A senha atual e armazenada de forma criptografada e nao pode ser exibida.'}
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Salvar' : 'Cadastrar'}</button>
              </div>
            </form>
          </div>
        </div></Portal>
      )}
    </div>
  );
}
