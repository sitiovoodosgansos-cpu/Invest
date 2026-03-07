import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, getInitials,
  getMonthsDifference, calculateCompoundInterest
} from '../utils/helpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { Plus, Trash2, Wallet, TrendingUp } from 'lucide-react';

const COLORS = ['#6C2BD9', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'];

export default function Financial() {
  const { investors, financialInvestments, addFinancialInvestment, deleteFinancialInvestment } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ investorId: '', amount: '', date: new Date().toISOString().slice(0, 10) });

  const investmentDetails = useMemo(() => {
    return financialInvestments.map(inv => {
      const months = getMonthsDifference(inv.date);
      const currentValue = calculateCompoundInterest(parseFloat(inv.amount), 0.03, months);
      const profit = currentValue - parseFloat(inv.amount);
      const investor = investors.find(i => i.id === inv.investorId);
      return { ...inv, months, currentValue, profit, investorName: investor?.name || 'Desconhecido' };
    });
  }, [financialInvestments, investors]);

  const totalInvested = investmentDetails.reduce((s, i) => s + parseFloat(i.amount), 0);
  const totalCurrent = investmentDetails.reduce((s, i) => s + i.currentValue, 0);
  const totalProfit = totalCurrent - totalInvested;

  // Chart: by investor
  const chartData = useMemo(() => {
    const grouped = {};
    investmentDetails.forEach(inv => {
      if (!grouped[inv.investorName]) {
        grouped[inv.investorName] = { name: inv.investorName, investido: 0, atual: 0, lucro: 0 };
      }
      grouped[inv.investorName].investido += parseFloat(inv.amount);
      grouped[inv.investorName].atual += inv.currentValue;
      grouped[inv.investorName].lucro += inv.profit;
    });
    return Object.values(grouped);
  }, [investmentDetails]);

  const handleSubmit = (e) => {
    e.preventDefault();
    addFinancialInvestment({
      investorId: form.investorId,
      amount: parseFloat(form.amount),
      date: form.date,
    });
    setForm({ investorId: '', amount: '', date: new Date().toISOString().slice(0, 10) });
    setShowModal(false);
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Aportes Financeiros</h2>
        <p>Capital investido com rendimento de 3% ao mes (juros compostos)</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon purple"><Wallet size={20} /></div>
          <div className="stat-label">Total Aportado</div>
          <div className="stat-value">{formatCurrency(totalInvested)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon green"><TrendingUp size={20} /></div>
          <div className="stat-label">Valor Atual</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(totalCurrent)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon blue"><TrendingUp size={20} /></div>
          <div className="stat-label">Rendimento Total</div>
          <div className="stat-value" style={{ color: 'var(--info)' }}>{formatCurrency(totalProfit)}</div>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Novo Aporte
        </button>
      </div>

      {chartData.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">Aportes por Investidor</span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={v => `R$${v.toFixed(0)}`} />
                <Tooltip formatter={v => formatCurrency(v)} />
                <Bar dataKey="investido" name="Investido" fill="#6C2BD9" radius={[4, 4, 0, 0]} />
                <Bar dataKey="lucro" name="Rendimento" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {investmentDetails.length > 0 ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Todos os Aportes</span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Investidor</th>
                  <th>Data</th>
                  <th>Valor Aportado</th>
                  <th>Meses</th>
                  <th>Valor Atual</th>
                  <th>Rendimento</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {investmentDetails.map(inv => (
                  <tr key={inv.id}>
                    <td><strong>{inv.investorName}</strong></td>
                    <td>{formatDate(inv.date)}</td>
                    <td>{formatCurrency(inv.amount)}</td>
                    <td>{inv.months}</td>
                    <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(inv.currentValue)}</td>
                    <td style={{ color: 'var(--info)', fontWeight: 600 }}>+{formatCurrency(inv.profit)}</td>
                    <td>
                      <button className="btn-icon" onClick={() => {
                        if (window.confirm('Remover este aporte?')) deleteFinancialInvestment(inv.id);
                      }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <Wallet size={48} />
          <h3>Nenhum aporte financeiro</h3>
          <p>Registre aportes de capital dos investidores</p>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Novo Aporte Financeiro</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Investidor *</label>
                <select className="form-input" required value={form.investorId} onChange={e => setForm({ ...form, investorId: e.target.value })}>
                  <option value="">Selecione</option>
                  {investors.map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Valor (R$) *</label>
                  <input className="form-input" type="number" step="0.01" min="0" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0,00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Data do Aporte *</label>
                  <input className="form-input" type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
              </div>
              <div style={{ padding: 12, background: 'var(--info-bg)', borderRadius: 'var(--radius-sm)', marginTop: 8, fontSize: 13, color: 'var(--info)' }}>
                Rendimento: 3% ao mes com juros compostos
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Registrar Aporte</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
