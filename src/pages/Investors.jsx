import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { formatCurrency, getInitials, calculateProfitDistribution, investidorEncerrado } from '../utils/helpers';
import { saldoOrnabird, diaBrasilia } from '../utils/ordens';
import { hashPassword } from '../utils/crypto';
import { UserPlus, Trash2, Edit, Search, Mail, Phone, Users, Key, Eye, EyeOff, Link, Check, XCircle, Archive, RotateCcw } from 'lucide-react';
import Portal from '../components/Portal';

// Um so lugar com os campos do formulario. Antes esta lista aparecia escrita
// por extenso em quatro pontos (estado inicial, "novo investidor", pos-salvar,
// e a edicao); acrescentar um campo exigia lembrar dos quatro, e o que ficasse
// de fora viraria um campo que some sozinho ao salvar.
function formatDataBr(iso) {
  const dia = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return '—';
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

const FORMULARIO_VAZIO = {
  name: '', email: '', phone: '', document: '',
  pixKey: '',
  // Padrao ligado: o dono pediu que quem nao vendeu receba o aviso do dia.
  avisoZeroVendas: true,
  loginUsername: '', loginPassword: '',
};

export default function Investors() {
  const {
    investors, birds, sales,
    addInvestor, updateInvestor, deleteInvestor,
    generateInvestorPortalToken, revokeInvestorPortalToken,
    generateInvestorPagesToken, revokeInvestorPagesToken,
    eggProfitRate, birdProfitRate,
    ornabirdVitrine, paymentOrders,
  } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  // loginPassword in the form is always the plaintext value the admin just typed.
  // On save we hash it before persisting. On edit we never pre-fill the field
  // (since we only store the hash) — an empty value means "keep the existing password".
  const [form, setForm] = useState(FORMULARIO_VAZIO);
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

  // O erro real do Firestore, traduzido. Antes isto era um "verifique sua
  // conexao" para qualquer falha — e as duas causas provaveis aqui nao tem
  // nada a ver com conexao: a regra do /shareTokens pode nao aceitar o tipo
  // novo, ou a cota diaria do Firebase pode ter acabado. Dizer qual e a
  // diferenca entre consertar em um minuto e ficar adivinhando.
  const explicarErro = (err) => {
    const codigo = String(err?.code || err?.message || 'erro desconhecido');
    if (codigo.includes('permission-denied')) {
      return 'O Firestore recusou a gravacao (permission-denied). A regra de '
        + '/shareTokens precisa aceitar o tipo "investor_pages" — publique a '
        + 'regra atualizada no console do Firebase e tente de novo.';
    }
    if (codigo.toLowerCase().includes('resource-exhausted')) {
      return 'A cota diaria do Firebase acabou (resource-exhausted). Ela zera '
        + 'a meia-noite no horario do Pacifico, por volta das 4h da manha aqui. '
        + 'Tente depois disso, ou mude o projeto para o plano Blaze.';
    }
    if (codigo.includes('unauthenticated')) {
      return 'Sua sessao expirou. Saia, entre de novo e tente outra vez.';
    }
    return `Nao foi possivel gerar o link: ${codigo}`;
  };

  // Link das TELAS (Plantel, Coleta, Prateleira, Chocadeiras, Vitrine).
  // Vive ao lado do link do relatorio, com token proprio: revogar um nao
  // derruba o outro.
  const [copiedPagesId, setCopiedPagesId] = useState(null);
  const [pendingPagesId, setPendingPagesId] = useState(null);

  const buildPagesLink = (token) => {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}#/investidor/${token}`;
  };

  const copyPagesLink = (token, investorId) => {
    if (!token) return;
    navigator.clipboard.writeText(buildPagesLink(token)).then(() => {
      setCopiedPagesId(investorId);
      setTimeout(() => setCopiedPagesId(null), 2000);
    });
  };

  const handleGeneratePagesToken = async (investorId) => {
    if (pendingPagesId) return;
    setPendingPagesId(investorId);
    try {
      await generateInvestorPagesToken(investorId);
    } catch (err) {
      window.alert(explicarErro(err));
    } finally {
      setPendingPagesId(null);
    }
  };

  const handleRevokePagesToken = async (investorId) => {
    if (pendingPagesId) return;
    if (!window.confirm('Revogar o link das telas deste investidor? Ele deixara de abrir imediatamente.')) {
      return;
    }
    setPendingPagesId(investorId);
    try {
      await revokeInvestorPagesToken(investorId);
    } catch (err) {
      window.alert(explicarErro(err));
    } finally {
      setPendingPagesId(null);
    }
  };

  const handleGeneratePortalToken = async (investorId) => {
    if (pendingTokenId) return;
    setPendingTokenId(investorId);
    try {
      await generateInvestorPortalToken(investorId);
    } catch (err) {
      window.alert(explicarErro(err));
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
    } catch (err) {
      window.alert(explicarErro(err));
    } finally {
      setPendingTokenId(null);
    }
  };

  const distribution = useMemo(
    () => calculateProfitDistribution(sales, birds, { eggProfitRate, birdProfitRate }),
    [sales, birds, eggProfitRate, birdProfitRate]
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
    setForm(FORMULARIO_VAZIO);
    setEditingId(null);
    setShowModal(false);
    setShowPassword(false);
  };

  const handleEdit = (investor) => {
    // Never pre-fill loginPassword on edit: we only have the hash, and we do
    // not want the admin to accidentally overwrite it with the hash string.
    setForm({
      ...FORMULARIO_VAZIO,
      name: investor.name,
      email: investor.email || '',
      phone: investor.phone || '',
      document: investor.document || '',
      pixKey: investor.pixKey || '',
      // Nunca gravado = recebe o aviso. So o `false` explicito desliga.
      avisoZeroVendas: investor.avisoZeroVendas !== false,
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

  // Quanto ainda esta em aberto de cada um nas vendas do Ornabird. E o numero
  // que decide se encerrar agora deixa alguem sem receber.
  const emAberto = useMemo(() => {
    const mapa = new Map();
    for (const s of saldoOrnabird({
      vendas: Array.isArray(ornabirdVitrine) ? ornabirdVitrine : [],
      birds,
      investors,
      rates: { eggProfitRate, birdProfitRate },
      ordens: Array.isArray(paymentOrders) ? paymentOrders : [],
    })) mapa.set(s.investorId, s.aPagar);
    return mapa;
  }, [ornabirdVitrine, birds, investors, eggProfitRate, birdProfitRate, paymentOrders]);

  // ENCERRAR NAO E APAGAR.
  //
  // Apagar leva junto as aves e o historico de rateio: os relatorios de meses
  // passados passariam a mostrar numeros diferentes dos que o investidor
  // recebeu na epoca. Encerrar so tira ele das listas de trabalho — o passado
  // fica exatamente como estava, e o que ainda esta em aberto continua devido.
  const handleEncerrar = (investor) => {
    const aberto = emAberto.get(investor.id) || 0;
    const alerta = aberto > 0
      ? `\n\nATENCAO: ainda ha ${formatCurrency(aberto)} em aberto para ${investor.name}. `
        + 'Encerrar nao apaga essa divida — as vendas continuam na fila para voce '
        + 'gerar a ordem final.'
      : '';
    if (!window.confirm(
      `Encerrar a participação de ${investor.name}?${alerta}\n\n`
      + 'Ele sai da lista de ativos e vai para os arquivados. As aves, as vendas e '
      + 'os relatórios continuam como estão, e você pode reativar quando quiser.'
    )) return;
    updateInvestor(investor.id, {
      encerradoEm: diaBrasilia(),
      encerradoPor: 'admin',
    });
  };

  const handleReativar = (investor) => {
    if (!window.confirm(`Reativar a participação de ${investor.name}?`)) return;
    updateInvestor(investor.id, { encerradoEm: null, encerradoPor: null });
  };

  const filtered = investors.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase())
  );
  const ativos = filtered.filter(i => !investidorEncerrado(i));
  const arquivados = filtered.filter(investidorEncerrado);

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
        <button className="btn btn-primary" onClick={() => { setForm(FORMULARIO_VAZIO); setEditingId(null); setShowModal(true); setShowPassword(false); }}>
          <UserPlus size={16} /> Novo Investidor
        </button>
      </div>

      <div className="grid-3">
        {ativos.map(investor => {
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
                  <button
                    className="btn-icon"
                    onClick={() => handleEncerrar(investor)}
                    title="Encerrar participacao (vai para os arquivados)"
                  >
                    <Archive size={16} />
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

              {/* Link das TELAS: Plantel, Coleta de Ovos, Prateleira,
                  Chocadeiras e Vitrine, so com as aves deste investidor e
                  somente para consulta. */}
              {investor.pagesTokenId ? (
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={() => copyPagesLink(investor.pagesTokenId, investor.id)}
                    disabled={pendingPagesId === investor.id}
                    style={{
                      width: '100%', padding: '10px 16px', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', gap: 8,
                      border: copiedPagesId === investor.id ? '2px solid var(--success)' : '2px solid var(--info, #3B82F6)',
                      borderRadius: 'var(--radius-sm)',
                      background: copiedPagesId === investor.id ? 'var(--success-bg)' : '#eff6ff',
                      color: copiedPagesId === investor.id ? 'var(--success)' : 'var(--info, #3B82F6)',
                      fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.2s',
                    }}
                  >
                    {copiedPagesId === investor.id ? <Check size={16} /> : <Link size={16} />}
                    {copiedPagesId === investor.id ? 'Link copiado!' : 'Copiar link das telas'}
                  </button>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 6 }}>
                    <button
                      onClick={() => handleGeneratePagesToken(investor.id)}
                      disabled={pendingPagesId === investor.id}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-secondary)',
                        fontSize: 11, cursor: pendingPagesId === investor.id ? 'wait' : 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Renovar link
                    </button>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>|</span>
                    <button
                      onClick={() => handleRevokePagesToken(investor.id)}
                      disabled={pendingPagesId === investor.id}
                      style={{
                        background: 'none', border: 'none', color: 'var(--danger)',
                        fontSize: 11, cursor: pendingPagesId === investor.id ? 'wait' : 'pointer',
                        textDecoration: 'underline', display: 'inline-flex',
                        alignItems: 'center', gap: 4,
                      }}
                    >
                      <XCircle size={11} /> Revogar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => handleGeneratePagesToken(investor.id)}
                  disabled={pendingPagesId === investor.id}
                  style={{
                    width: '100%', marginTop: 8, padding: '10px 16px', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', gap: 8,
                    border: '2px dashed var(--info, #3B82F6)',
                    borderRadius: 'var(--radius-sm)', background: '#eff6ff',
                    color: 'var(--info, #3B82F6)', fontWeight: 600, fontSize: 13,
                    cursor: pendingPagesId === investor.id ? 'wait' : 'pointer',
                    opacity: pendingPagesId === investor.id ? 0.6 : 1, transition: 'all 0.2s',
                  }}
                >
                  <Link size={16} />
                  {pendingPagesId === investor.id ? 'Gerando...' : 'Gerar link das telas'}
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

      {ativos.length === 0 && arquivados.length > 0 && (
        <div className="empty-state">
          <Users size={48} />
          <h3>Nenhum investidor ativo</h3>
          <p>Os encerrados continuam abaixo, com o histórico intacto</p>
        </div>
      )}

      {/* OS ARQUIVADOS.
          Cartao enxuto de proposito: quem esta aqui nao esta em operacao, entao
          links de portal e estatisticas de plantel so ocupariam espaco. O que
          importa e a data da saida e se sobrou alguma coisa pra pagar. */}
      {arquivados.length > 0 && (
        <div style={{ marginTop: 32 }}>
          {/* Icone e titulo num invólucro so: `card-header` distribui os filhos
              com space-between, e soltos eles iriam parar em pontas opostas. */}
          <div className="card-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Archive size={18} />
              <span className="card-title">Investidores arquivados ({arquivados.length})</span>
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
            Participação encerrada. Não recebem aviso de vendas e não aparecem para
            receber ave nova — mas as aves, as vendas e os relatórios do período
            deles continuam exatamente como estavam.
          </p>
          <div className="grid-3">
            {arquivados.map(investor => {
              const investorBirds = birds.filter(b => b.investorId === investor.id);
              const aberto = emAberto.get(investor.id) || 0;
              return (
                <div className="investor-card" key={investor.id} style={{ opacity: 0.85 }}>
                  <div className="investor-card-header">
                    <div className="investor-avatar" style={{ filter: 'grayscale(1)' }}>
                      {getInitials(investor.name)}
                    </div>
                    <div className="investor-info" style={{ flex: 1 }}>
                      <h3>{investor.name}</h3>
                      <p>Encerrado em {formatDataBr(investor.encerradoEm)}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon edit" onClick={() => handleReativar(investor)} title="Reativar participacao">
                        <RotateCcw size={16} />
                      </button>
                      <button className="btn-icon" onClick={() => handleDelete(investor.id)} title="Remover">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="investor-stats">
                    <div>
                      <div className="investor-stat-label">Espécies</div>
                      <div className="investor-stat-value">{investorBirds.length}</div>
                    </div>
                    <div>
                      <div className="investor-stat-label">Em aberto</div>
                      <div
                        className="investor-stat-value"
                        style={{ color: aberto > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}
                      >
                        {formatCurrency(aberto)}
                      </div>
                    </div>
                  </div>

                  {aberto > 0 && (
                    <div style={{
                      marginTop: 10, fontSize: 12, lineHeight: 1.5,
                      background: '#fef3c7', color: '#92400e',
                      padding: '8px 10px', borderRadius: 8,
                    }}>
                      Ainda há {formatCurrency(aberto)} a pagar. As vendas continuam na
                      fila em Ordens de Pagamento para o acerto final.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">CPF/CNPJ</label>
                  <input className="form-input" value={form.document} onChange={e => setForm({ ...form, document: e.target.value })} placeholder="000.000.000-00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Chave PIX</label>
                  <input
                    className="form-input"
                    value={form.pixKey}
                    onChange={e => setForm({ ...form, pixKey: e.target.value })}
                    placeholder="CPF, telefone, e-mail ou aleatoria"
                  />
                </div>
              </div>
              {/* A ordem do dia sai por e-mail: sem endereco, o investidor
                  simplesmente nao recebe, e isso so apareceria como um erro
                  depois do pagamento feito. */}
              {!form.email.trim() && (
                <div style={{
                  marginBottom: 16, padding: '8px 12px', background: '#fffbeb',
                  borderLeft: '3px solid #f59e0b', borderRadius: 4,
                  fontSize: 12, color: '#92400e', lineHeight: 1.5,
                }}>
                  Sem e-mail, este investidor nao recebe a ordem de pagamento dele.
                </div>
              )}
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.avisoZeroVendas}
                    onChange={e => setForm({ ...form, avisoZeroVendas: e.target.checked })}
                    style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 13, lineHeight: 1.5 }}>
                    Avisar quando nao houver venda no dia
                    <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12 }}>
                      Um e-mail curto dizendo que nao houve venda, com o convite para
                      aumentar o plantel. Desligue para quem vende raramente — o mesmo
                      aviso todo dia costuma acabar na caixa de spam, e leva a ordem de
                      pagamento junto.
                    </span>
                  </span>
                </label>
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
