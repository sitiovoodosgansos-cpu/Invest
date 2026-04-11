import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, getInitials,
  getMonthsDifference, calculateCompoundInterest, calculateProfitDistribution
} from '../utils/helpers';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { Plus, Trash2, Wallet, TrendingUp, DollarSign, Send } from 'lucide-react';
import Portal from '../components/Portal';

const COLORS = ['#6C2BD9', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6'];

export default function Financial() {
  const { investors, birds, sales, financialInvestments, payments, addFinancialInvestment, deleteFinancialInvestment, addPayment, deletePayment } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [form, setForm] = useState({ investorId: '', amount: '', date: new Date().toISOString().slice(0, 10) });
  const [paymentForm, setPaymentForm] = useState({ investorId: '', amount: '', date: new Date().toISOString().slice(0, 10), description: '' });

  const distribution = useMemo(() => calculateProfitDistribution(sales, birds), [sales, birds]);

  const investmentDetails = useMemo(() => {
    return financialInvestments.map(inv => {
      const months = getMonthsDifference(inv.date);
      const currentValue = calculateCompoundInterest(parseFloat(inv.amount), 0.03, months);
      const profit = currentValue - parseFloat(inv.amount);
      const investor = investors.find(i => i.id === inv.investorId);
      return { ...inv, months, currentValue, profit, investorName: investor?.name || 'Desconhecido' };
    });
  }, [financialInvestments, investors]);

  const allPayments = useMemo(() => {
    return (payments || []).map(p => {
      const investor = investors.find(i => i.id === p.investorId);
      return { ...p, investorName: investor?.name || 'Desconhecido' };
    }).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [payments, investors]);

  // Calculate balances per investor
  const investorBalances = useMemo(() => {
    const balances = {};
    // Sum financial investments (current value with interest)
    investmentDetails.forEach(inv => {
      if (!balances[inv.investorId]) {
        balances[inv.investorId] = { name: inv.investorName, invested: 0, currentValue: 0, financialProfit: 0, salesProfit: 0, totalPaid: 0 };
      }
      balances[inv.investorId].invested += parseFloat(inv.amount);
      balances[inv.investorId].currentValue += inv.currentValue;
      balances[inv.investorId].financialProfit += inv.profit;
    });
    // Sum sales profit
    Object.entries(distribution.distribution).forEach(([investorId, dist]) => {
      if (!balances[investorId]) {
        const investor = investors.find(i => i.id === investorId);
        balances[investorId] = { name: investor?.name || 'Desconhecido', invested: 0, currentValue: 0, financialProfit: 0, salesProfit: 0, totalPaid: 0 };
      }
      balances[investorId].salesProfit += dist.totalProfit;
    });
    // Subtract payments
    (payments || []).forEach(p => {
      if (!balances[p.investorId]) {
        const investor = investors.find(i => i.id === p.investorId);
        balances[p.investorId] = { name: investor?.name || 'Desconhecido', invested: 0, currentValue: 0, financialProfit: 0, salesProfit: 0, totalPaid: 0 };
      }
      balances[p.investorId].totalPaid += parseFloat(p.amount);
    });
    // Calculate net balance
    return Object.entries(balances).map(([id, b]) => ({
      investorId: id,
      ...b,
      totalAccumulated: b.currentValue + b.salesProfit,
      netBalance: b.currentValue + b.salesProfit - b.totalPaid,
    }));
  }, [investmentDetails, distribution, payments, investors]);

  const totalInvested = investmentDetails.reduce((s, i) => s + parseFloat(i.amount), 0);
  const totalCurrent = investmentDetails.reduce((s, i) => s + i.currentValue, 0);
  const totalProfit = totalCurrent - totalInvested;
  const totalPaid = (payments || []).reduce((s, p) => s + parseFloat(p.amount), 0);

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

  const handlePaymentSubmit = (e) => {
    e.preventDefault();
    addPayment({
      investorId: paymentForm.investorId,
      amount: parseFloat(paymentForm.amount),
      date: paymentForm.date,
      description: paymentForm.description || 'Pagamento ao investidor',
    });
    setPaymentForm({ investorId: '', amount: '', date: new Date().toISOString().slice(0, 10), description: '' });
    setShowPaymentModal(false);
  };

  // Get balance for selected investor in payment modal
  const selectedPaymentBalance = useMemo(() => {
    if (!paymentForm.investorId) return null;
    return investorBalances.find(b => b.investorId === paymentForm.investorId);
  }, [paymentForm.investorId, investorBalances]);

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
        <div className="stat-card">
          <div className="stat-card-icon orange"><Send size={20} /></div>
          <div className="stat-label">Total Pago</div>
          <div className="stat-value" style={{ color: 'var(--warning)' }}>{formatCurrency(totalPaid)}</div>
        </div>
      </div>

      <div className="filter-bar">
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setShowPaymentModal(true)} style={{ marginRight: 8 }}>
          <Send size={16} /> Registrar Pagamento
        </button>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Novo Aporte
        </button>
      </div>

      {/* Balance per investor */}
      {investorBalances.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">Saldo por Investidor</span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Investidor</th>
                  <th>Aporte + Rend.</th>
                  <th>Lucro Vendas</th>
                  <th>Total Acumulado</th>
                  <th>Total Pago</th>
                  <th>Saldo Liquido</th>
                </tr>
              </thead>
              <tbody>
                {investorBalances.map(b => (
                  <tr key={b.investorId}>
                    <td><strong>{b.name}</strong></td>
                    <td>{formatCurrency(b.currentValue)}</td>
                    <td>{formatCurrency(b.salesProfit)}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(b.totalAccumulated)}</td>
                    <td style={{ color: 'var(--warning)', fontWeight: 600 }}>{formatCurrency(b.totalPaid)}</td>
                    <td style={{ color: b.netBalance >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                      {formatCurrency(b.netBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
        <div className="card" style={{ marginBottom: 24 }}>
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
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <Wallet size={48} />
          <h3>Nenhum aporte financeiro</h3>
          <p>Registre aportes de capital dos investidores</p>
        </div>
      )}

      {/* Payment History */}
      {allPayments.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Historico de Pagamentos ({allPayments.length})</span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Investidor</th>
                  <th>Descricao</th>
                  <th>Valor Pago</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {allPayments.map(p => (
                  <tr key={p.id}>
                    <td>{formatDate(p.date)}</td>
                    <td><strong>{p.investorName}</strong></td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{p.description || '-'}</td>
                    <td style={{ color: 'var(--warning)', fontWeight: 700 }}>{formatCurrency(p.amount)}</td>
                    <td>
                      <button className="btn-icon" onClick={() => {
                        if (window.confirm('Remover este pagamento?')) deletePayment(p.id);
                      }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--warning-bg, #fef3c7)', borderRadius: 'var(--radius-sm)', marginTop: 16, textAlign: 'right' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--warning, #d97706)' }}>Total pago: {formatCurrency(totalPaid)}</span>
          </div>
        </div>
      )}

      {/* New Investment Modal */}
      {showModal && (
        <Portal><div className="modal-overlay" onClick={() => setShowModal(false)}>
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
        </div></Portal>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <Portal><div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Registrar Pagamento</h3>
            <form onSubmit={handlePaymentSubmit}>
              <div className="form-group">
                <label className="form-label">Investidor *</label>
                <select className="form-input" required value={paymentForm.investorId} onChange={e => setPaymentForm({ ...paymentForm, investorId: e.target.value })}>
                  <option value="">Selecione</option>
                  {investors.map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              </div>
              {selectedPaymentBalance && (
                <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', marginBottom: 12, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>Aporte + Rendimento:</span>
                    <strong>{formatCurrency(selectedPaymentBalance.currentValue)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>Lucro com Vendas:</span>
                    <strong>{formatCurrency(selectedPaymentBalance.salesProfit)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>Ja pago:</span>
                    <strong style={{ color: 'var(--warning)' }}>-{formatCurrency(selectedPaymentBalance.totalPaid)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
                    <span style={{ fontWeight: 700 }}>Saldo disponivel:</span>
                    <strong style={{ color: 'var(--success)', fontSize: 15 }}>{formatCurrency(selectedPaymentBalance.netBalance)}</strong>
                  </div>
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Valor (R$) *</label>
                  <input className="form-input" type="number" step="0.01" min="0.01" required value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} placeholder="0,00" />
                </div>
                <div className="form-group">
                  <label className="form-label">Data do Pagamento *</label>
                  <input className="form-input" type="date" required value={paymentForm.date} onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Descricao</label>
                <input className="form-input" type="text" value={paymentForm.description} onChange={e => setPaymentForm({ ...paymentForm, description: e.target.value })} placeholder="Ex: Pagamento lucro mensal, Resgate parcial..." />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPaymentModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary"><Send size={14} /> Registrar Pagamento</button>
              </div>
            </form>
          </div>
        </div></Portal>
      )}
    </div>
  );
}
