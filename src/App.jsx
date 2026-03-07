import React, { useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Dashboard from './pages/Dashboard';
import Investors from './pages/Investors';
import Plantel from './pages/Plantel';
import Sales from './pages/Sales';
import Financial from './pages/Financial';
import Reports from './pages/Reports';
import {
  LayoutDashboard, Users, Bird, ShoppingCart, Wallet, FileBarChart, Menu, X
} from 'lucide-react';

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { to: '/dashboard', icon: <LayoutDashboard />, label: 'Dashboard' },
    { to: '/investidores', icon: <Users />, label: 'Investidores' },
    { to: '/plantel', icon: <Bird />, label: 'Plantel' },
    { to: '/vendas', icon: <ShoppingCart />, label: 'Vendas' },
    { to: '/financeiro', icon: <Wallet />, label: 'Financeiro' },
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
          <Route path="/vendas" element={<Sales />} />
          <Route path="/financeiro" element={<Financial />} />
          <Route path="/relatorios" element={<Reports />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <AppLayout />
      </HashRouter>
    </AppProvider>
  );
}
