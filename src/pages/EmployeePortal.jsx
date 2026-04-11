import React, { useState, useEffect, Component } from 'react';
import { Routes, Route, NavLink, Navigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useApp } from '../context/AppContext';
import EggCollection from './EggCollection';
import Incubators from './Incubators';
import Pintinhos from './Pintinhos';
import Sanidade from './Sanidade';
import { Bird, Egg, Thermometer, Heart, Baby, Menu, X } from 'lucide-react';

// ErrorBoundary
class PortalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="login-page">
          <div className="login-card" style={{ textAlign: 'center' }}>
            <div className="login-logo"><Bird size={28} /></div>
            <h3>Erro ao carregar portal</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
              Ocorreu um erro ao carregar os dados. Tente novamente.
            </p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Recarregar</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function EmployeePortalContent() {
  const { token } = useParams();
  const appData = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // tokenChecked: has the /shareTokens lookup finished? We block the
  // "Link inválido" screen until we know, so a valid token doesn't flash
  // the error state on first paint.
  const [tokenChecked, setTokenChecked] = useState(false);
  const [shareTokenValid, setShareTokenValid] = useState(false);

  const loading = appData.loading;
  const firestoreError = appData.firestoreError;

  // Legacy employee token still persisted in /config/appData.employeeToken
  // for deployments that haven't rotated to /shareTokens yet. Accept either.
  const legacyEmployeeToken = appData.employeeToken || '';

  // Look the token up in /shareTokens first. This collection is admin-only
  // for list, but `get` is open so any client holding the token can
  // validate it. Legacy fallback below handles pre-Phase-2B links.
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setTokenChecked(true);
      setShareTokenValid(false);
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'shareTokens', token));
        if (cancelled) return;
        if (snap.exists() && snap.data().type === 'employee') {
          setShareTokenValid(true);
        } else {
          setShareTokenValid(false);
        }
      } catch {
        if (!cancelled) setShareTokenValid(false);
      } finally {
        if (!cancelled) setTokenChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const tokenValid = shareTokenValid
    || (!!legacyEmployeeToken && token === legacyEmployeeToken);

  if (loading || !tokenChecked) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: 12, background: '#f8fafc' }}>
        <div style={{ width: 36, height: 36, border: '3px solid #E2E8F0', borderTopColor: '#6C2BD9', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: '#64748B', fontSize: 14 }}>Carregando portal do funcionário...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (firestoreError) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div className="login-logo"><Bird size={28} /></div>
          <h3>Erro de conexão</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            Não foi possível carregar os dados. Tente novamente em alguns instantes.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Tentar novamente</button>
        </div>
      </div>
    );
  }

  if (!tokenValid) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div className="login-logo"><Bird size={28} /></div>
          <h3>Link inválido</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            Este link de acesso não foi encontrado ou expirou. Solicite um novo link ao administrador.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Tentar novamente</button>
        </div>
      </div>
    );
  }

  const navItems = [
    { to: `/funcionario/${token}/coleta-ovos`, icon: <Egg />, label: 'Coleta de Ovos' },
    { to: `/funcionario/${token}/chocadeiras`, icon: <Thermometer />, label: 'Chocadeiras' },
    { to: `/funcionario/${token}/pintinhos`, icon: <Baby />, label: 'Pintinhos' },
    { to: `/funcionario/${token}/sanidade`, icon: <Heart />, label: 'Sanidade' },
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
            <span>Portal do Funcionário</span>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: '#10b981',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 12, fontWeight: 700,
            }}>F</div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Funcionário
            </span>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Acesso limitado - Operações do sítio
          </p>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="coleta-ovos" element={<EggCollection />} />
          <Route path="chocadeiras" element={<Incubators />} />
          <Route path="pintinhos" element={<Pintinhos />} />
          <Route path="sanidade" element={<Sanidade />} />
          <Route path="*" element={<Navigate to={`/funcionario/${token}/coleta-ovos`} replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function EmployeePortal() {
  return (
    <PortalErrorBoundary>
      <EmployeePortalContent />
    </PortalErrorBoundary>
  );
}
