import React, { useState } from 'react';
import { useApp, BIRD_SPECIES } from '../context/AppContext';
import { formatCurrency, getInitials } from '../utils/helpers';
import { Plus, Trash2, Edit, Search, Bird, PlusCircle, X } from 'lucide-react';

const SPECIES_EMOJI = {
  'Galinha': '🐔', 'Faisão': '🪶', 'Pavão': '🦚', 'Pato': '🦆',
  'Marreco': '🦆', 'Peru': '🦃', 'Ganso': '🪿', 'Codorna': '🐦',
  'Coelho': '🐰', 'Cachorro': '🐕', 'Gato': '🐱', 'Cavalo': '🐴',
  'Ovelha': '🐑', 'Cabra': '🐐', 'Porco': '🐷', 'Vaca': '🐄',
  'Cisne': '🦢', 'Emu': '🪶', 'Avestruz': '🪶',
};

export default function Plantel() {
  const { investors, birds, addBird, updateBird, deleteBird, customSpecies, addCustomSpecies, deleteCustomSpecies } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [showNewAnimalModal, setShowNewAnimalModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [filterInvestor, setFilterInvestor] = useState('');
  const [form, setForm] = useState({
    investorId: '', species: '', breed: '', matrixCount: '', breederCount: '', investmentValue: '',
  });

  // New animal form
  const [newAnimalForm, setNewAnimalForm] = useState({ species: '', breeds: '' });

  // Merge built-in + custom species
  const allSpecies = [...BIRD_SPECIES, ...(customSpecies || [])];
  const selectedSpeciesData = allSpecies.find(s => s.species === form.species);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingId) {
      updateBird(editingId, form);
    } else {
      addBird(form);
    }
    resetForm();
  };

  const resetForm = () => {
    setForm({ investorId: '', species: '', breed: '', matrixCount: '', breederCount: '', investmentValue: '' });
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
    });
    setEditingId(bird.id);
    setShowModal(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Remover este animal do plantel?')) deleteBird(id);
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
    setNewAnimalForm({ species: '', breeds: '' });
    setShowNewAnimalModal(false);
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
        <button className="btn btn-secondary" onClick={() => setShowNewAnimalModal(true)} title="Cadastrar novo tipo de animal">
          <PlusCircle size={16} /> Novo Animal
        </button>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
          <Plus size={16} /> Cadastrar no Plantel
        </button>
      </div>

      <div className="grid-3">
        {filtered.map(bird => (
          <div className="bird-card" key={bird.id}>
            <div className="bird-card-header">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span className="bird-emoji">{SPECIES_EMOJI[bird.species] || '🐾'}</span>
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
          <h3>Nenhum animal cadastrado</h3>
          <p>Cadastre animais no plantel para comecar</p>
        </div>
      )}

      {/* Modal Cadastrar no Plantel */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{editingId ? 'Editar Animal' : 'Cadastrar no Plantel'}</h3>
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

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Salvar' : 'Cadastrar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Cadastrar Novo Animal */}
      {showNewAnimalModal && (
        <div className="modal-overlay" onClick={() => setShowNewAnimalModal(false)}>
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
        </div>
      )}
    </div>
  );
}
