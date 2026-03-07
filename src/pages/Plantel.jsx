import React, { useState } from 'react';
import { useApp, BIRD_SPECIES } from '../context/AppContext';
import { formatCurrency, getInitials } from '../utils/helpers';
import { Plus, Trash2, Edit, Search, Bird, Filter } from 'lucide-react';

const SPECIES_EMOJI = {
  'Galinha': '🐔', 'Faisão': '🪶', 'Pavão': '🦚', 'Pato': '🦆',
  'Marreco': '🦆', 'Peru': '🦃', 'Ganso': '🪿', 'Codorna': '🐦',
};

export default function Plantel() {
  const { investors, birds, addBird, updateBird, deleteBird } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [filterInvestor, setFilterInvestor] = useState('');
  const [customSpecies, setCustomSpecies] = useState('');
  const [customBreed, setCustomBreed] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [form, setForm] = useState({
    investorId: '', species: '', breed: '', matrixCount: '', breederCount: '', investmentValue: '',
  });

  const selectedSpeciesData = BIRD_SPECIES.find(s => s.species === form.species);

  const handleSubmit = (e) => {
    e.preventDefault();
    const finalSpecies = useCustom ? customSpecies : form.species;
    const finalBreed = useCustom ? customBreed : form.breed;
    const birdData = {
      ...form,
      species: finalSpecies,
      breed: finalBreed,
    };
    if (editingId) {
      updateBird(editingId, birdData);
    } else {
      addBird(birdData);
    }
    resetForm();
  };

  const resetForm = () => {
    setForm({ investorId: '', species: '', breed: '', matrixCount: '', breederCount: '', investmentValue: '' });
    setCustomSpecies('');
    setCustomBreed('');
    setUseCustom(false);
    setEditingId(null);
    setShowModal(false);
  };

  const handleEdit = (bird) => {
    const isKnownSpecies = BIRD_SPECIES.some(s => s.species === bird.species);
    const isKnownBreed = isKnownSpecies && BIRD_SPECIES.find(s => s.species === bird.species)?.breeds.includes(bird.breed);

    if (!isKnownSpecies || !isKnownBreed) {
      setUseCustom(true);
      setCustomSpecies(bird.species);
      setCustomBreed(bird.breed);
    } else {
      setUseCustom(false);
    }

    setForm({
      investorId: bird.investorId,
      species: bird.species,
      breed: bird.breed,
      matrixCount: bird.matrixCount || '',
      breederCount: bird.breederCount || '',
      investmentValue: bird.investmentValue || '',
    });
    setEditingId(bird.id);
    setShowModal(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Remover esta ave do plantel?')) deleteBird(id);
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
        <p>Gerencie as aves matrizes e reprodutores dos investidores</p>
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
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
          <Plus size={16} /> Cadastrar Ave
        </button>
      </div>

      <div className="grid-3">
        {filtered.map(bird => (
          <div className="bird-card" key={bird.id}>
            <div className="bird-card-header">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span className="bird-emoji">{SPECIES_EMOJI[bird.species] || '🐦'}</span>
                <div className="bird-info">
                  <h4>{bird.breed}</h4>
                  <p>{bird.species}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn-icon edit" onClick={() => handleEdit(bird)} title="Editar">
                  <Edit size={14} />
                </button>
                <button className="btn-icon" onClick={() => handleDelete(bird.id)} title="Remover">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <div className="investor-avatar" style={{ width: 24, height: 24, fontSize: 10, borderRadius: 6 }}>
                {getInitials(getInvestorName(bird.investorId))}
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{getInvestorName(bird.investorId)}</span>
            </div>

            <div className="bird-details">
              <span className="badge badge-purple">{bird.matrixCount || 0} Matrizes</span>
              <span className="badge badge-blue">{bird.breederCount || 0} Reprodutores</span>
            </div>

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
              <div className="investor-stat-label">Valor Investido</div>
              <div className="investor-stat-value" style={{ color: 'var(--primary)' }}>
                {formatCurrency(bird.investmentValue)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <Bird size={48} />
          <h3>Nenhuma ave cadastrada</h3>
          <p>Cadastre aves no plantel para comecar</p>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{editingId ? 'Editar Ave' : 'Cadastrar Nova Ave'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Investidor *</label>
                <select className="form-input" required value={form.investorId} onChange={e => setForm({ ...form, investorId: e.target.value })}>
                  <option value="">Selecione o investidor</option>
                  {investors.map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={useCustom}
                    onChange={e => setUseCustom(e.target.checked)}
                  />
                  Especie/Raca personalizada (nao listada)
                </label>
              </div>

              {useCustom ? (
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Especie *</label>
                    <input
                      className="form-input"
                      required
                      value={customSpecies}
                      onChange={e => setCustomSpecies(e.target.value)}
                      placeholder="Ex: Cisne, Emu..."
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Raca *</label>
                    <input
                      className="form-input"
                      required
                      value={customBreed}
                      onChange={e => setCustomBreed(e.target.value)}
                      placeholder="Ex: Branco, Negro..."
                    />
                  </div>
                </div>
              ) : (
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Especie *</label>
                    <select className="form-input" required value={form.species} onChange={e => setForm({ ...form, species: e.target.value, breed: '' })}>
                      <option value="">Selecione</option>
                      {BIRD_SPECIES.map(s => (
                        <option key={s.species} value={s.species}>{SPECIES_EMOJI[s.species] || '🐦'} {s.species}</option>
                      ))}
                    </select>
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
              )}

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
