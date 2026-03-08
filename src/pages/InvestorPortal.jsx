import React, { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, calculateProfitDistribution,
  getInitials, getMonthsDifference, calculateCompoundInterest
} from '../utils/helpers';
import { LogOut, Bird, Wallet, TrendingUp, ShoppingCart, DollarSign } from 'lucide-react';

export default function InvestorPortal() {
  const { currentUser, logout } = useAuth();
  const { investors, birds, sales, financialInvestments } = useApp();

  const investor = investors.find(i => i.id === currentUser.investorId);
  const distribution = useMemo(() => calculateProfitDistribution(sales, birds), [sales, birds]);

  if (!investor) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h3>Investidor nao encontrado</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>Sua conta pode ter sido removida. Entre em contato com o administrador.</p>
          <button className="btn btn-primary" onClick={logout}><LogOut size={16} /> Sair</button>
        </div>
      </div>
    );
  }

  const myBirds = birds.filter(b => b.investorId === investor.id);
  const myFinancial = financialInvestments.filter(f => f.investorId === investor.id);
  const myDistribution = distribution.distribution[investor.id];
  const mySales = myDistribution ? myDistribution.items : [];

  const totalInvested = myBirds.reduce((s, b) => s + (parseFloat(b.investmentValue) || 0), 0);
  const totalMatrices = myBirds.reduce((s, b) => s + (parseInt(b.matrixCount) || 0), 0);
  const totalBreeders = myBirds.reduce((s, b) => s + (parseInt(b.breederCount) || 0), 0);
  const totalProfit = myDistribution ? myDistribution.totalProfit : 0;

  const totalFinancialInvested = myFinancial.reduce((s, f) => s + f.amount, 0);
  const totalFinancialCurrent = myFinancial.reduce((s, f) => {
    const months = getMonthsDifference(f.date, new Date().toISOString());
    return s + calculateCompoundInterest(f.amount, 0.03, months);
  }, 0);
  const totalFinancialProfit = totalFinancialCurrent - totalFinancialInvested;

  return (
    <div className="investor-portal">
      {/* Header */}
      <header className="portal-header">
        <div className="portal-header-left">
          <div className="portal-logo">
            <Bird size={22} />
          </div>
          <div>
            <h1>Sitio Voo dos Gansos</h1>
            <span>Painel do Investidor</span>
          </div>
        </div>
        <div className="portal-header-right">
          <div className="portal-user">
            <div className="investor-avatar" style={{ width: 36, height: 36, fontSize: 13 }}>{getInitials(investor.name)}</div>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{investor.name}</span>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={logout}>
            <LogOut size={14} /> Sair
          </button>
        </div>
      </header>

      <main className="portal-content">
        {/* Summary Stats */}
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-card-icon purple"><Bird size={20} /></div>
            <div className="stat-label">Plantel</div>
            <div className="stat-value">{myBirds.length} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>especies</span></div>
            <div className="stat-change" style={{ color: 'var(--text-secondary)' }}>{totalMatrices} matrizes / {totalBreeders} reprodutores</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon blue"><Wallet size={20} /></div>
            <div className="stat-label">Total Investido</div>
            <div className="stat-value" style={{ fontSize: 20 }}>{formatCurrency(totalInvested + totalFinancialInvested)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon green"><TrendingUp size={20} /></div>
            <div className="stat-label">Lucro com Vendas</div>
            <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>{formatCurrency(totalProfit)}</div>
            <div className="stat-change" style={{ color: 'var(--text-secondary)' }}>{mySales.length} vendas vinculadas</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-icon orange"><DollarSign size={20} /></div>
            <div className="stat-label">Rendimento Financeiro</div>
            <div className="stat-value" style={{ fontSize: 20, color: 'var(--success)' }}>{formatCurrency(totalFinancialProfit)}</div>
            <div className="stat-change" style={{ color: 'var(--text-secondary)' }}>3% a.m. juros compostos</div>
          </div>
        </div>

        {/* My Birds */}
        {myBirds.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Meu Plantel</span>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Especie / Raca</th>
                    <th>Matrizes</th>
                    <th>Reprodutores</th>
                    <th>Valor Investido</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {myBirds.map(b => (
                    <tr key={b.id}>
                      <td><strong>{b.species} - {b.breed}</strong></td>
                      <td>{b.matrixCount || 0}</td>
                      <td>{b.breederCount || 0}</td>
                      <td style={{ color: 'var(--primary)', fontWeight: 600 }}>{formatCurrency(b.investmentValue || 0)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatDate(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Financial Investments */}
        {myFinancial.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Aportes Financeiros</span>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Valor Aportado</th>
                    <th>Periodo</th>
                    <th>Valor Atual</th>
                    <th>Rendimento</th>
                  </tr>
                </thead>
                <tbody>
                  {myFinancial.map(f => {
                    const months = getMonthsDifference(f.date, new Date().toISOString());
                    const current = calculateCompoundInterest(f.amount, 0.03, months);
                    return (
                      <tr key={f.id}>
                        <td>{formatDate(f.date)}</td>
                        <td>{formatCurrency(f.amount)}</td>
                        <td>{months} meses</td>
                        <td style={{ fontWeight: 600 }}>{formatCurrency(current)}</td>
                        <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(current - f.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 16px', background: 'var(--success-bg)', borderRadius: 'var(--radius-sm)', marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Total investido: {formatCurrency(totalFinancialInvested)}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--success)' }}>Valor atual: {formatCurrency(totalFinancialCurrent)} (+{formatCurrency(totalFinancialProfit)})</span>
            </div>
          </div>
        )}

        {/* Sales / Profit Distribution */}
        {mySales.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Vendas Vinculadas ({mySales.length})</span>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Item</th>
                    <th>Tipo</th>
                    <th>Valor Venda</th>
                    <th>Taxa</th>
                    <th>Seu Lucro</th>
                  </tr>
                </thead>
                <tbody>
                  {mySales.map((item, idx) => (
                    <tr key={idx}>
                      <td>{formatDate(item.date || item.importedAt)}</td>
                      <td>{item.itemDescription || item.item || '-'}</td>
                      <td>
                        <span className={`badge ${item.isEgg ? 'badge-purple' : 'badge-blue'}`}>
                          {item.isEgg ? 'Ovo' : 'Ave'}
                        </span>
                      </td>
                      <td>{formatCurrency(item.totalValue)}</td>
                      <td>{(item.rate * 100).toFixed(1)}%</td>
                      <td style={{ color: 'var(--success)', fontWeight: 600 }}>{formatCurrency(item.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 16px', background: 'var(--primary-bg)', borderRadius: 'var(--radius-sm)', marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13 }}>
                Ovos: <strong style={{ color: 'var(--primary)' }}>{formatCurrency(myDistribution.eggProfit)}</strong>
                {' | '}
                Aves: <strong style={{ color: 'var(--info)' }}>{formatCurrency(myDistribution.birdProfit)}</strong>
              </span>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>Total: {formatCurrency(totalProfit)}</span>
            </div>
          </div>
        )}

        {myBirds.length === 0 && myFinancial.length === 0 && mySales.length === 0 && (
          <div className="empty-state">
            <Bird size={48} />
            <h3>Nenhum investimento registrado</h3>
            <p>Seus dados aparecerão aqui assim que o administrador registrar seus investimentos.</p>
          </div>
        )}
      </main>
    </div>
  );
}
