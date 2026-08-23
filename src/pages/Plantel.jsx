import React, { useState, useMemo } from 'react';
import { useApp, BIRD_SPECIES } from '../context/AppContext';
import {
  formatCurrency, getInitials, formatDate, formatPercent, getOwnershipPeriods,
  getEggProfitRate, resolveRateFor, hasRateOverride,
  calculateBirdReturns, investidorEncerrado, buildOrnabirdGroupIndex,
  resolveMirrorBird,
} from '../utils/helpers';
import {
  percentualDoOvo, precoOvoDoLote, indicePrecoOvo, getMultiplicadorAve, arredondar,
} from '../utils/ordens';
import { Plus, Trash2, Edit, Search, Bird, PlusCircle, X, ArrowLeftRight, History, Link2 } from 'lucide-react';
import Portal from '../components/Portal';
import OrnabirdGroupPicker from '../components/OrnabirdGroupPicker';

const EMPTY_BIRD_FORM = {
  investorId: '', species: '', breed: '', matrixCount: '', breederCount: '',
  investmentValue: '', ownershipStartDate: '', ownershipEndDate: '',
  eggProfitRate: '', precoOvoReferencia: '', ornabirdGroupId: '',
};

// Form <-> stored value conversion for the optional per-animal rates.
// The form holds a percentage string ('12,5'); storage holds a fraction
// (0.125). An empty field means "no override — use the global rate".
const pctToRate = (value) => {
  const s = String(value ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = parseFloat(s);
  return isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
};
// Preco em reais digitado no formulario. Vazio = 'nao tenho preco proprio',
// e ai a referencia vem do historico de venda de ovo do lote ou do geral.
const precoDigitado = (value) => {
  const s = String(value ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : null;
};

const rateToPct = (rate) =>
  typeof rate === 'number' && isFinite(rate)
    ? String((rate * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''))
    : '';

const SPECIES_EMOJI = {
  'Galinha': '🐔', 'Faisão': '🪶', 'Pavão': '🦚', 'Pato': '🦆',
  'Marreco': '🦆', 'Peru': '🦃', 'Ganso': '🪿', 'Codorna': '🐦',
  'Coelho': '🐰', 'Cachorro': '🐕', 'Gato': '🐱', 'Cavalo': '🐴',
  'Ovelha': '🐑', 'Cabra': '🐐', 'Porco': '🐷', 'Vaca': '🐄',
  'Cisne': '🦢', 'Emu': '🪶', 'Avestruz': '🪶',
};

export default function Plantel() {
  const {
    investors, birds, sales, addBird, updateBird, deleteBird, transferBird,
    customSpecies, addCustomSpecies, deleteCustomSpecies,
    eggProfitRate: globalEggRate, birdProfitRate: globalBirdRate,
    comissaoConfig, ornabirdVitrine,
    somenteLeitura,
  } = useApp();
  // Global fallback rates, used as placeholders and to show each animal's
  // effective rate when it has no override of its own.
  const globals = { eggProfitRate: globalEggRate, birdProfitRate: globalBirdRate };

  // How much each animal has already returned. Same rate and ownership rules
  // as the investor statements, so the figures always agree.
  const birdReturns = useMemo(
    () => calculateBirdReturns(sales, birds, globals),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, birds, globalEggRate, globalBirdRate]
  );
  const [showModal, setShowModal] = useState(false);
  const [showNewAnimalModal, setShowNewAnimalModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [filterInvestor, setFilterInvestor] = useState('');
  const [form, setForm] = useState({ ...EMPTY_BIRD_FORM });
  // Bird currently being handed over to another investor.
  const [transferTarget, setTransferTarget] = useState(null);

  // A CONTA DA AVE, mostrada enquanto o dono digita.
  //
  // Sem isto o formulario pede um percentual e um preco de ovo e nao diz o que
  // sai deles — e o que sai deles e exatamente o que o investidor vai receber
  // por cada ave vendida. Ver o "R$ 9,60 por ave" aparecer enquanto se digita e
  // o que transforma dois campos soltos numa decisao consciente.
  const indicePreco = useMemo(
    () => indicePrecoOvo(
      Array.isArray(ornabirdVitrine) ? ornabirdVitrine : [],
      (v) => resolveMirrorBird(v, buildOrnabirdGroupIndex(birds)),
    ),
    [ornabirdVitrine, birds]
  );
  const loteEmEdicao = {
    id: editingId,
    eggProfitRate: pctToRate(form.eggProfitRate),
    precoOvoReferencia: precoDigitado(form.precoOvoReferencia),
  };
  const precoObservado = editingId ? (indicePreco.get(editingId)?.preco ?? null) : null;
  const percentualAtual = percentualDoOvo(loteEmEdicao, comissaoConfig);
  const precoAtual = precoOvoDoLote(loteEmEdicao, comissaoConfig, indicePreco).preco;
  const multiplicador = getMultiplicadorAve(comissaoConfig);
  const comissaoDaAve = precoAtual != null
    ? arredondar(multiplicador * percentualAtual * precoAtual)
    : null;

  // As mesmas contas, pro cartao de cada lote da lista.
  const precoDoOvo = (bird) => {
    const achado = precoOvoDoLote(bird, comissaoConfig, indicePreco);
    return achado.preco == null ? null : achado;
  };
  // O que o INVESTIDOR ganha por ovo. E isto que o cartao mostra; o preco de
  // venda no site fica no formulario de edicao, que e onde ele e digitado.
  //
  // O cartao fala de comissao — "Ovos 5,2%", "Ave R$ 5,82" —, e o preco cheio
  // no meio disso era o unico numero que nao era do investidor. Trocado pelo
  // lucro, as tres etiquetas passam a contar a mesma historia, e a regra dos
  // quatro ovos fica visivel: R$ 1,46 no ovo, R$ 5,82 na ave.
  const lucroPorOvoDoLote = (bird) => {
    const achado = precoDoOvo(bird);
    if (!achado) return null;
    return arredondar(percentualDoOvo(bird, comissaoConfig) * achado.preco);
  };
  const comissaoPorAveDoLote = (bird) => {
    const achado = precoDoOvo(bird);
    if (!achado) return null;
    // Do preco CHEIO, arredondando uma vez so no fim — nao de lucroPorOvoDoLote
    // vezes quatro. Sao contas diferentes quando o centavo cai no meio, e esta
    // e a que a fila de pagamento usa (comissaoDaVenda, em utils/ordens.js).
    // Mudar aqui pra fechar com a etiqueta do ovo mudaria o que se paga.
    return arredondar(multiplicador * percentualDoOvo(bird, comissaoConfig) * achado.preco);
  };
  const [transferForm, setTransferForm] = useState({ toInvestorId: '', transferDate: '' });
  // Bird whose ownership history panel is expanded.
  const [historyBirdId, setHistoryBirdId] = useState(null);

  // New animal form
  const [newAnimalForm, setNewAnimalForm] = useState({ species: '', breeds: '' });

  // Merge built-in + custom species (combine breeds when species name matches)
  const allSpecies = (() => {
    const merged = BIRD_SPECIES.map(s => {
      const custom = (customSpecies || []).find(c => c.species.toLowerCase() === s.species.toLowerCase());
      if (custom) {
        const extraBreeds = custom.breeds.filter(b => !s.breeds.includes(b));
        return extraBreeds.length > 0 ? { ...s, breeds: [...s.breeds, ...extraBreeds] } : s;
      }
      return s;
    });
    // Add custom species that don't match any built-in
    const extras = (customSpecies || []).filter(
      c => !BIRD_SPECIES.some(s => s.species.toLowerCase() === c.species.toLowerCase())
    );
    return [...merged, ...extras];
  })();
  const selectedSpeciesData = allSpecies.find(s => s.species === form.species);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Blank rate fields persist as null, i.e. "fall back to the global rate".
    const payload = {
      ...form,
      eggProfitRate: pctToRate(form.eggProfitRate),
      // Preco em reais, nao percentual: vai como numero ou null.
      precoOvoReferencia: precoDigitado(form.precoOvoReferencia),
      ornabirdGroupId: (form.ornabirdGroupId || '').trim() || null,
    };
    if (editingId) {
      updateBird(editingId, payload);
    } else {
      addBird(payload);
    }
    resetForm();
  };

  const resetForm = () => {
    setForm({ ...EMPTY_BIRD_FORM });
    setEditingId(null);
    setShowModal(false);
  };

  const handleEdit = (bird) => {
    setForm({
      investorId: bird.investorId,
      species: bird.species,
      breed: bird.breed,
      matrixCount: bird.matrixCount || '',
      breederCount: bird.breederCount || '',
      investmentValue: bird.investmentValue || '',
      ownershipStartDate: bird.ownershipStartDate || '',
      ownershipEndDate: bird.ownershipEndDate || '',
      eggProfitRate: rateToPct(bird.eggProfitRate),
      precoOvoReferencia: typeof bird.precoOvoReferencia === 'number'
        ? String(bird.precoOvoReferencia) : '',
      ornabirdGroupId: bird.ornabirdGroupId || '',
    });
    setEditingId(bird.id);
    setShowModal(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Remover este animal do plantel?')) deleteBird(id);
  };

  const openTransfer = (bird) => {
    setTransferTarget(bird);
    setTransferForm({ toInvestorId: '', transferDate: new Date().toISOString().slice(0, 10) });
  };

  const handleTransferSubmit = (e) => {
    e.preventDefault();
    if (!transferTarget || !transferForm.toInvestorId || !transferForm.transferDate) return;
    transferBird(transferTarget.id, {
      toInvestorId: transferForm.toInvestorId,
      transferDate: transferForm.transferDate,
    });
    setTransferTarget(null);
    setTransferForm({ toInvestorId: '', transferDate: '' });
  };

  const handleNewAnimalSubmit = (e) => {
    e.preventDefault();
    const species = newAnimalForm.species.trim();
    const breeds = newAnimalForm.breeds
      .split(',')
      .map(b => b.trim())
      .filter(b => b.length > 0);
    if (!species || breeds.length === 0) return;

    addCustomSpecies({ species, breeds });

    // Auto-select the new species in the plantel form
    setForm(prev => ({ ...prev, species, breed: '' }));

    setNewAnimalForm({ species: '', breeds: '' });
    // Keep the modal open so user can see confirmation and add more if needed
  };

  const handleDeleteCustomSpecies = (speciesName) => {
    if (window.confirm(`Remover "${speciesName}" da lista de animais?`)) {
      deleteCustomSpecies(speciesName);
    }
  };

  const filtered = birds.filter(b => {
    const matchSearch = `${b.species} ${b.breed}`.toLowerCase().includes(search.toLowerCase());
    const matchInvestor = !filterInvestor || b.investorId === filterInvestor;
    return matchSearch && matchInvestor;
  });

  const getInvestorName = (id) => investors.find(i => i.id === id)?.name || 'Desconhecido';

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Plantel</h2>
        <p>Gerencie os animais matrizes e reprodutores dos investidores</p>
      </div>

      <div className="filter-bar">
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            style={{ paddingLeft: 36 }}
            placeholder="Buscar especie ou raca..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-input"
          style={{ width: 'auto', minWidth: 180 }}
          value={filterInvestor}
          onChange={e => setFilterInvestor(e.target.value)}
        >
          <option value="">Todos os investidores</option>
          {investors.map(i => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
        {!somenteLeitura && (
          <>
            <button className="btn btn-secondary" onClick={() => setShowNewAnimalModal(true)} title="Cadastrar novo tipo de animal">
              <PlusCircle size={16} /> Novo Animal
            </button>
            <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
              <Plus size={16} /> Cadastrar no Plantel
            </button>
          </>
        )}
      </div>

      <div className="grid-3">
        {filtered.map(bird => {
          const pastPeriods = getOwnershipPeriods(bird).filter(p => !p.current);
          const showHistory = historyBirdId === bird.id;
          const hasPeriod = !!(bird.ownershipStartDate || bird.ownershipEndDate);
          return (
            <div className="bird-card" key={bird.id}>
              <div className="bird-card-header">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="bird-emoji">{SPECIES_EMOJI[bird.species] || '🐾'}</span>
                  <div className="bird-info">
                    <h4>{bird.breed}</h4>
                    <p>{bird.species}</p>
                  </div>
                </div>
                {!somenteLeitura && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn-icon"
                      onClick={() => openTransfer(bird)}
                      title="Transferir para outro investidor"
                      style={{ color: 'var(--info, #3B82F6)' }}
                    >
                      <ArrowLeftRight size={14} />
                    </button>
                    <button className="btn-icon edit" onClick={() => handleEdit(bird)} title="Editar">
                      <Edit size={14} />
                    </button>
                    <button className="btn-icon" onClick={() => handleDelete(bird.id)} title="Remover">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <div className="investor-avatar" style={{ width: 24, height: 24, fontSize: 10, borderRadius: 6 }}>
                  {getInitials(getInvestorName(bird.investorId))}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getInvestorName(bird.investorId)}</span>
                {pastPeriods.length > 0 && (
                  <button
                    onClick={() => setHistoryBirdId(showHistory ? null : bird.id)}
                    title="Ver historico de titularidade"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                      display: 'flex', alignItems: 'center', gap: 3,
                      fontSize: 11, color: 'var(--primary)',
                    }}
                  >
                    <History size={12} /> {pastPeriods.length} anterior{pastPeriods.length > 1 ? 'es' : ''}
                  </button>
                )}
              </div>

              {bird.ornabirdGroupId && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 8,
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                  background: '#ede9fe', color: '#6C2BD9',
                }} title={`Lote ${bird.ornabirdGroupId} no Ornabird`}>
                  <Link2 size={11} /> Ornabird
                </div>
              )}

              {hasPeriod && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Titular de {bird.ownershipStartDate ? formatDate(bird.ownershipStartDate) : 'sempre'}
                  {' '}ate {bird.ownershipEndDate ? formatDate(bird.ownershipEndDate) : 'hoje'}
                </div>
              )}

              {showHistory && pastPeriods.length > 0 && (
                <div style={{
                  marginBottom: 8, padding: 8, borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)', fontSize: 11,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>
                    Titulares anteriores
                  </div>
                  {pastPeriods.map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                      <span>{getInvestorName(p.investorId)}</span>
                      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {p.startDate ? formatDate(p.startDate) : 'inicio'} - {p.endDate ? formatDate(p.endDate) : 'hoje'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="bird-details">
                <span className="badge badge-purple">{bird.matrixCount || 0} Matrizes</span>
                <span className="badge badge-blue">{bird.breederCount || 0} Reprodutores</span>
              </div>

              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
                <div className="investor-stat-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Taxa de Lucro
                  {!hasRateOverride(bird) && (
                    <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>(padrao geral)</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <span
                    className="badge"
                    style={{
                      background: typeof bird.eggProfitRate === 'number' ? '#fef3c7' : 'var(--bg-secondary)',
                      color: typeof bird.eggProfitRate === 'number' ? '#d97706' : 'var(--text-secondary)',
                    }}
                    title={typeof bird.eggProfitRate === 'number'
                      ? 'Percentual proprio deste lote'
                      : 'Ainda sem percentual proprio — usando o geral'}
                  >
                    Ovos {formatPercent(resolveRateFor(bird, true, globals))}
                  </span>
                  {/* O LUCRO DO OVO — o que o investidor recebe por ovo vendido.
                      O preco de venda que gera este numero mora no formulario de
                      edicao; aqui ele aparece so na dica, pra dar de conferir sem
                      abrir o lote. */}
                  <span
                    className="badge"
                    style={{
                      background: lucroPorOvoDoLote(bird) != null ? '#dcfce7' : '#fee2e2',
                      color: lucroPorOvoDoLote(bird) != null ? '#15803d' : '#b91c1c',
                    }}
                    title={precoDoOvo(bird) != null
                      ? `${formatPercent(percentualDoOvo(bird, comissaoConfig))} de ${formatCurrency(precoDoOvo(bird).preco)}`
                        + (precoDoOvo(bird).fonte === 'venda'
                          ? ' — preco da ultima venda de ovo deste lote'
                          : ' — preco digitado neste lote')
                      : 'Sem preco de ovo: preencha no lote ou registre uma venda de ovo'}
                  >
                    Ovo {lucroPorOvoDoLote(bird) != null
                      ? formatCurrency(lucroPorOvoDoLote(bird))
                      : 'sem preco'}
                  </span>
                  {/* A ave nao tem percentual proprio: ela vale um valor fixo,
                      derivado do ovo. O cartao mostra o valor ja calculado —
                      um percentual aqui seria uma conta que nao existe mais. */}
                  <span
                    className="badge"
                    style={{
                      background: comissaoPorAveDoLote(bird) != null ? '#dbeafe' : '#fee2e2',
                      color: comissaoPorAveDoLote(bird) != null ? '#2563eb' : '#b91c1c',
                    }}
                    title={comissaoPorAveDoLote(bird) != null
                      ? `${multiplicador} ovos deste lote: `
                        + `${multiplicador} x ${formatPercent(percentualDoOvo(bird, comissaoConfig))}`
                        + ` de ${formatCurrency(precoDoOvo(bird).preco)}`
                      : 'Sem preco de ovo: a venda de ave deste lote fica fora da fila'}
                  >
                    {comissaoPorAveDoLote(bird) != null
                      ? `Ave ${formatCurrency(comissaoPorAveDoLote(bird))}`
                      : 'Ave sem preco de ovo'}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-light)', display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="investor-stat-label">Valor Investido</div>
                  <div className="investor-stat-value" style={{ color: 'var(--primary)' }}>
                    {formatCurrency(bird.investmentValue)}
                  </div>
                </div>
                {(() => {
                  const ret = birdReturns[bird.id] || { profit: 0, currentOwnerProfit: 0, saleCount: 0 };
                  const invested = parseFloat(bird.investmentValue) || 0;
                  const payback = invested > 0 ? (ret.profit / invested) * 100 : null;
                  const splitOwners = ret.profit - ret.currentOwnerProfit > 0.005;
                  return (
                    <div style={{ flex: 1 }}>
                      <div className="investor-stat-label">Lucro do Investidor</div>
                      <div
                        className="investor-stat-value"
                        style={{ color: ret.profit > 0 ? 'var(--success)' : 'var(--text-muted)' }}
                      >
                        {formatCurrency(ret.profit)}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        {ret.saleCount > 0
                          ? `${ret.saleCount} venda${ret.saleCount > 1 ? 's' : ''}`
                          : 'sem vendas'}
                        {payback !== null && ret.profit > 0 && ` · ${payback.toFixed(0)}% do investido`}
                      </div>
                      {splitOwners && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          Titular atual: {formatCurrency(ret.currentOwnerProfit)}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <Bird size={48} />
          <h3>Nenhum animal cadastrado</h3>
          <p>Cadastre animais no plantel para comecar</p>
        </div>
      )}

      {/* Modal Cadastrar no Plantel */}
      {showModal && (
        <Portal><div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{editingId ? 'Editar Animal' : 'Cadastrar no Plantel'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Investidor *</label>
                {/* So os ativos: ave nova nao entra pra quem ja encerrou a
                    participacao. O filtro la em cima continua mostrando todos,
                    porque as aves antigas deles seguem no plantel.
                    O dono ATUAL entra na lista mesmo encerrado — sem isso,
                    editar a ave de um encerrado apagaria o vinculo dela, porque
                    o valor selecionado nao existiria entre as opcoes. */}
                <select className="form-input" required value={form.investorId} onChange={e => setForm({ ...form, investorId: e.target.value })}>
                  <option value="">Selecione o investidor</option>
                  {investors
                    .filter(i => !investidorEncerrado(i) || i.id === form.investorId)
                    .map(i => (
                      <option key={i.id} value={i.id}>
                        {i.name}{investidorEncerrado(i) ? ' (encerrado)' : ''}
                      </option>
                    ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Especie *</label>
                  <select className="form-input" required value={form.species} onChange={e => setForm({ ...form, species: e.target.value, breed: '' })}>
                    <option value="">Selecione</option>
                    {allSpecies.map(s => (
                      <option key={s.species} value={s.species}>{SPECIES_EMOJI[s.species] || '🐾'} {s.species}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => { setShowNewAnimalModal(true); }}
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 12, cursor: 'pointer', padding: '4px 0', marginTop: 4 }}
                  >
                    + Nao encontrou? Cadastrar novo animal
                  </button>
                </div>
                <div className="form-group">
                  <label className="form-label">Raca *</label>
                  <select className="form-input" required value={form.breed} onChange={e => setForm({ ...form, breed: e.target.value })}>
                    <option value="">Selecione</option>
                    {selectedSpeciesData?.breeds.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Qtd. Matrizes</label>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    value={form.matrixCount}
                    onChange={e => setForm({ ...form, matrixCount: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Qtd. Reprodutores</label>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    value={form.breederCount}
                    onChange={e => setForm({ ...form, breederCount: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Valor do Investimento (R$)</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.investmentValue}
                  onChange={e => setForm({ ...form, investmentValue: e.target.value })}
                  placeholder="0,00"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Taxa de Lucro - Ovos (%)</label>
                  <input
                    className="form-input"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={form.eggProfitRate}
                    onChange={e => setForm({ ...form, eggProfitRate: e.target.value })}
                    placeholder={`Padrao: ${formatPercent(getEggProfitRate(globals))}`}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Preco do ovo no site (R$)</label>
                  <input
                    className="form-input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.precoOvoReferencia}
                    onChange={e => setForm({ ...form, precoOvoReferencia: e.target.value })}
                    placeholder={precoObservado != null
                      ? `Ultima venda: ${formatCurrency(precoObservado)}`
                      : 'Sem venda de ovo ainda'}
                  />
                </div>
              </div>
              <div style={{
                fontSize: 12, color: 'var(--text-muted)', marginTop: -4, marginBottom: 14,
                lineHeight: 1.5,
              }}>
                O ovo rende esse percentual sobre o valor da venda. A <strong>ave rende um
                valor fixo</strong>: {multiplicador} ovos deste lote — {formatPercent(percentualAtual)}{' '}
                x {precoAtual != null ? formatCurrency(precoAtual) : 'preco do ovo'} x{' '}
                {multiplicador} ={' '}
                <strong>{precoAtual != null ? formatCurrency(comissaoDaAve) : '—'} por ave</strong>,
                independente da idade e do preco de venda dela.
                {precoAtual == null && (
                  <> Sem preco de ovo — nem digitado aqui, nem de uma venda de ovo anterior deste
                  lote — a venda de ave dele fica fora da fila de pagamento. Nao ha valor geral
                  pra cair: ovo de Brahma sai a R$ 24 e de Pavao a R$ 180.</>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Vinculo com o Ornabird</label>
                <OrnabirdGroupPicker
                  value={form.ornabirdGroupId}
                  onChange={id => setForm({ ...form, ornabirdGroupId: id })}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  Opcional. Ao vincular, a coleta de ovos, a prateleira, a chocadeira e as vendas
                  deste lote passam a vir do Ornabird automaticamente — inclusive as chocadas,
                  cujos filhotes seguem este mesmo investidor.
                </span>
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4, marginBottom: 8 }}>
                O <strong>preco do ovo nao tem valor geral</strong>: ovo de Brahma sai a R$ 24 e de
                Pavao Branco a R$ 180, entao ele mora aqui, no lote. Em branco, o sistema usa o preco
                da ultima venda de ovo deste lote; sem nenhuma venda de ovo, a venda de ave deste
                lote fica fora da fila de pagamento ate voce preencher.
                {' '}O percentual em branco cai no geral — preencha quando este lote tiver margem
                propria, que e o caso de quem bota poucos ovos e precisa de um percentual maior pra
                a conta da ave fechar.
                {' '}Vale para vendas novas: as ordens ja emitidas ficam com os valores com que sairam.
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Titular desde</label>
                  <input
                    className="form-input"
                    type="date"
                    value={form.ownershipStartDate}
                    onChange={e => setForm({ ...form, ownershipStartDate: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Titular ate</label>
                  <input
                    className="form-input"
                    type="date"
                    value={form.ownershipEndDate}
                    onChange={e => setForm({ ...form, ownershipEndDate: e.target.value })}
                  />
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4, marginBottom: 8 }}>
                Opcional. Define o periodo em que este investidor recebe o lucro das vendas deste animal.
                Deixe em branco para valer sempre. Para passar o animal a outro investidor, use o botao
                de transferencia no card — o historico e preservado.
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Salvar' : 'Cadastrar'}</button>
              </div>
            </form>
          </div>
        </div></Portal>
      )}

      {/* Modal Transferir Titularidade */}
      {transferTarget && (
        <Portal><div className="modal-overlay" onClick={() => setTransferTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Transferir Titularidade</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              <strong>{transferTarget.species} - {transferTarget.breed}</strong>, hoje de{' '}
              <strong>{getInvestorName(transferTarget.investorId)}</strong>.
            </p>
            <form onSubmit={handleTransferSubmit}>
              <div className="form-group">
                <label className="form-label">Novo Investidor *</label>
                <select
                  className="form-input"
                  required
                  value={transferForm.toInvestorId}
                  onChange={e => setTransferForm({ ...transferForm, toInvestorId: e.target.value })}
                >
                  <option value="">Selecione o investidor</option>
                  {investors
                    .filter(i => i.id !== transferTarget.investorId)
                    .map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Data da Transferencia *</label>
                <input
                  className="form-input"
                  type="date"
                  required
                  value={transferForm.transferDate}
                  onChange={e => setTransferForm({ ...transferForm, transferDate: e.target.value })}
                />
              </div>
              <div style={{
                padding: 12, background: 'var(--info-bg, #dbeafe)', color: 'var(--info, #2563eb)',
                borderRadius: 'var(--radius-sm)', fontSize: 12, marginTop: 8,
              }}>
                As vendas ate o dia anterior continuam sendo do titular atual. A partir da data
                escolhida, o lucro passa a ser do novo investidor. Nenhuma venda ja registrada
                e apagada — o historico fica guardado no animal.
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setTransferTarget(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">
                  <ArrowLeftRight size={14} /> Transferir
                </button>
              </div>
            </form>
          </div>
        </div></Portal>
      )}

      {/* Modal Cadastrar Novo Animal */}
      {showNewAnimalModal && (
        <Portal><div className="modal-overlay" onClick={() => setShowNewAnimalModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Cadastrar Novo Tipo de Animal</h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Adicione um novo tipo de animal ao sistema. Ele ficara disponivel na lista de especies para todos os cadastros.
            </p>
            <form onSubmit={handleNewAnimalSubmit}>
              <div className="form-group">
                <label className="form-label">Nome do Animal / Especie *</label>
                <input
                  className="form-input"
                  required
                  value={newAnimalForm.species}
                  onChange={e => setNewAnimalForm({ ...newAnimalForm, species: e.target.value })}
                  placeholder="Ex: Coelho, Cachorro, Gato, Cisne..."
                />
              </div>
              <div className="form-group">
                <label className="form-label">Racas (separadas por virgula) *</label>
                <input
                  className="form-input"
                  required
                  value={newAnimalForm.breeds}
                  onChange={e => setNewAnimalForm({ ...newAnimalForm, breeds: e.target.value })}
                  placeholder="Ex: Rex, Angorá, Lion Head, Mini Lop"
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  Separe cada raca com uma virgula. Voce pode adicionar mais racas depois.
                </span>
              </div>

              {/* List existing custom species */}
              {customSpecies && customSpecies.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <label className="form-label" style={{ marginBottom: 8 }}>Animais cadastrados por voce:</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {customSpecies.map(s => (
                      <div key={s.species} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-light)'
                      }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{SPECIES_EMOJI[s.species] || '🐾'} {s.species}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                            ({s.breeds.join(', ')})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomSpecies(s.species)}
                          style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 4 }}
                          title="Remover animal"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewAnimalModal(false)}>Fechar</button>
                <button type="submit" className="btn btn-primary">
                  <PlusCircle size={16} /> Cadastrar Animal
                </button>
              </div>
            </form>
          </div>
        </div></Portal>
      )}
    </div>
  );
}
