import React, { useEffect, useState, Component } from 'react';
import { Routes, Route, NavLink, Navigate, useParams } from 'react-router-dom';
import { PortalAppProvider } from '../context/PortalAppProvider';
import Plantel from './Plantel';
import EggCollection from './EggCollection';
import Prateleira from './Prateleira';
import Incubators from './Incubators';
import Vitrine from './Vitrine';
import { Bird, Egg, Layers, Thermometer, Store, Menu, X } from 'lucide-react';

// Portal do investidor — as telas operacionais, com as aves dele apenas.
//
// Separado do portal de relatório antigo (/portal/:token), que continua
// intocado: são tipos de token diferentes, então revogar um não derruba o
// outro.
//
// A diferença que importa não está aqui e sim em de onde vêm os dados. Este
// portal NUNCA lê o Firestore: ele pede a fatia ao servidor, que filtra pelos
// lotes vinculados a este investidor. Se lesse o Firestore como o app
// completo faz, o navegador do investidor receberia o banco inteiro e a
// separação seria só visual.
//
// Por isso a chamada aqui é direta e não passa pelo VITE_PORTAL_API: aquele
// interruptor existe para o portal antigo poder cair no comportamento antigo
// durante um rollout. Aqui não há comportamento antigo para o qual cair — sem
// servidor, não há portal.

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
        <Aviso titulo="Erro ao carregar">
          Ocorreu um erro ao montar o portal. Tente recarregar a página.
        </Aviso>
      );
    }
    return this.props.children;
  }
}

function Aviso({ titulo, children }) {
  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <div className="login-logo"><Bird size={28} /></div>
        <h3>{titulo}</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>{children}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

const MENSAGENS = {
  token_not_found: 'Este link não foi encontrado ou foi revogado. Peça um novo ao administrador.',
  invalid_token: 'Este link não é válido. Peça um novo ao administrador.',
  not_configured: 'O portal ainda não foi configurado no servidor. Avise o administrador.',
  server_error: 'O servidor não conseguiu montar os dados. Tente novamente em instantes.',
  network_error: 'Não foi possível falar com o servidor. Verifique a conexão.',
};

function Conteudo() {
  const { token } = useParams();
  const [estado, setEstado] = useState({ carregando: true, dados: null, erro: null });
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    let cancelado = false;
    if (!token) {
      setEstado({ carregando: false, dados: null, erro: 'invalid_token' });
      return undefined;
    }
    // O token vai no CORPO, nunca na URL: assim não entra em log de acesso,
    // histórico do navegador nem cabeçalho Referer.
    fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const corpo = await res.json().catch(() => ({}));
        if (cancelado) return;
        if (!res.ok) {
          setEstado({ carregando: false, dados: null, erro: corpo.error || 'server_error' });
          return;
        }
        setEstado({ carregando: false, dados: corpo, erro: null });
      })
      .catch(() => {
        if (!cancelado) setEstado({ carregando: false, dados: null, erro: 'network_error' });
      });
    return () => { cancelado = true; };
  }, [token]);

  if (estado.carregando) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh',
        flexDirection: 'column', gap: 12, background: '#f8fafc',
      }}>
        <div style={{
          width: 36, height: 36, border: '3px solid #E2E8F0', borderTopColor: '#6C2BD9',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ color: '#64748B', fontSize: 14 }}>Carregando seu portal...</p>
        <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
      </div>
    );
  }

  if (estado.erro || !estado.dados) {
    return (
      <Aviso titulo="Link indisponível">
        {MENSAGENS[estado.erro] || MENSAGENS.server_error}
      </Aviso>
    );
  }

  const investidor = estado.dados.investor;
  const base = `/investidor/${token}`;
  const itens = [
    { to: `${base}/plantel`, icon: <Bird />, label: 'Plantel' },
    { to: `${base}/coleta-ovos`, icon: <Egg />, label: 'Coleta de Ovos' },
    { to: `${base}/prateleira`, icon: <Layers />, label: 'Prateleira' },
    { to: `${base}/chocadeiras`, icon: <Thermometer />, label: 'Chocadeiras' },
    { to: `${base}/vitrine`, icon: <Store />, label: 'Vitrine' },
  ];

  return (
    <PortalAppProvider payload={estado.dados} loading={false} error={null}>
      <div className="app-layout">
        <button className="mobile-menu-btn" onClick={() => setMenuAberto(!menuAberto)}>
          {menuAberto ? <X size={20} /> : <Menu size={20} />}
        </button>

        <aside className={`sidebar ${menuAberto ? 'open' : ''}`}>
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon"><Bird size={22} /></div>
            <div>
              <h1>Sítio Voo dos Gansos</h1>
              <span>Portal do Investidor</span>
            </div>
          </div>

          <nav className="sidebar-nav">
            {itens.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setMenuAberto(false)}
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div style={{ padding: 12, borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', background: '#6C2BD9',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 12, fontWeight: 700,
              }}>
                {(investidor?.name || '?').slice(0, 1).toUpperCase()}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {investidor?.name || 'Investidor'}
              </span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Somente consulta — apenas as suas aves
            </p>
          </div>
        </aside>

        <main className="main-content">
          <Routes>
            <Route path="plantel" element={<Plantel />} />
            <Route path="coleta-ovos" element={<EggCollection />} />
            <Route path="prateleira" element={<Prateleira />} />
            <Route path="chocadeiras" element={<Incubators />} />
            <Route path="vitrine" element={<Vitrine />} />
            <Route path="*" element={<Navigate to={`${base}/plantel`} replace />} />
          </Routes>
        </main>
      </div>
    </PortalAppProvider>
  );
}

export default function InvestorPagesPortal() {
  return (
    <PortalErrorBoundary>
      <Conteudo />
    </PortalErrorBoundary>
  );
}
