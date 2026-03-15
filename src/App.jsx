import React, { Component, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { AppProvider } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';

// Global ErrorBoundary to prevent blank pages on crash
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('App crash:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h2 style={{ color: '#e53e3e' }}>Algo deu errado</h2>
          <p style={{ color: '#666', marginBottom: 16 }}>{this.state.error?.message}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{ padding: '10px 24px', background: '#6C2BD9', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}
          >
            Recarregar Pagina
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import Dashboard from './pages/Dashboard';
import Investors from './pages/Investors';
import Plantel from './pages/Plantel';
import Sales from './pages/Sales';
import Financial from './pages/Financial';
import Reports from './pages/Reports';
import Expenses from './pages/Expenses';
import EggCollection from './pages/EggCollection';
import Incubators from './pages/Incubators';
import Sanidade from './pages/Sanidade';
import Pintinhos from './pages/Pintinhos';
import Login from './pages/Login';
import InvestorPortal from './pages/InvestorPortal';
import DirectPortal from './pages/DirectPortal';
import {
  LayoutDashboard, Users, Bird, ShoppingCart, Wallet, FileBarChart, Menu, X, LogOut, Receipt, Egg, Thermometer, Heart, Baby
} from 'lucide-react';

function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { logout, currentUser } = useAuth();

  const navItems = [
    { to: '/dashboard', icon: <LayoutDashboard />, label: 'Dashboard' },
    { to: '/investidores', icon: <Users />, label: 'Investidores' },
    { to: '/plantel', icon: <Bird />, label: 'Plantel' },
    { to: '/coleta-ovos', icon: <Egg />, label: 'Coleta de Ovos' },
    { to: '/chocadeiras', icon: <Thermometer />, label: 'Chocadeiras' },
    { to: '/pintinhos', icon: <Baby />, label: 'Pintinhos' },
    { to: '/sanidade', icon: <Heart />, label: 'Sanidade' },
    { to: '/vendas', icon: <ShoppingCart />, label: 'Vendas' },
    { to: '/financeiro', icon: <Wallet />, label: 'Financeiro' },
    { to: '/despesas', icon: <Receipt />, label: 'Despesas' },
    { to: '/relatorios', icon: <FileBarChart />, label: 'Relatórios' },
  ];

  return (
    <div className="app-layout">
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Bird size={22} />
          </div>
          <div>
            <h1>Sítio Voo dos Gansos</h1>
            <span>Sistema de Investimentos</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: '12px', borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {currentUser?.username || 'Admin'}
            </span>
            <button
              className="btn btn-sm btn-secondary"
              style={{ padding: '4px 8px', fontSize: 11 }}
              onClick={logout}
            >
              <LogOut size={12} /> Sair
            </button>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            v1.0 - Sítio Voo dos Gansos
          </p>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/investidores" element={<Investors />} />
          <Route path="/plantel" element={<Plantel />} />
          <Route path="/coleta-ovos" element={<EggCollection />} />
          <Route path="/chocadeiras" element={<Incubators />} />
          <Route path="/pintinhos" element={<Pintinhos />} />
          <Route path="/sanidade" element={<Sanidade />} />
          <Route path="/vendas" element={<Sales />} />
          <Route path="/financeiro" element={<Financial />} />
          <Route path="/despesas" element={<Expenses />} />
          <Route path="/relatorios" element={<Reports />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function AppRouter() {
  const { currentUser, isAdmin, isInvestor, adminLoading } = useAuth();
  const { loading } = useApp();

  if (loading || adminLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Carregando...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (!currentUser) {
    return <Login />;
  }

  if (isInvestor) {
    return <InvestorPortal />;
  }

  if (isAdmin) {
    return <AdminLayout />;
  }

  return <Login />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AuthProvider>
          <HashRouter>
            <Routes>
              <Route path="/portal/:token" element={<DirectPortal />} />
              <Route path="*" element={<AppRouter />} />
            </Routes>
          </HashRouter>
        </AuthProvider>
      </AppProvider>
    </ErrorBoundary>
  );
}
