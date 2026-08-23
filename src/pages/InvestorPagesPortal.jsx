import React, { useEffect, useState, Component } from 'react';
import { Routes, Route, NavLink, Navigate, useParams } from 'react-router-dom';
import { PortalAppProvider } from '../context/PortalAppProvider';
import Plantel from './Plantel';
import EggCollection from './EggCollection';
import Prateleira from './Prateleira';
import Incubators from './Incubators';
import Vitrine from './Vitrine';
import VendasOrnabird from './VendasOrnabird';
import { Bird, Egg, Layers, Thermometer, Store, ShoppingCart, Menu, X } from 'lucide-react';

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
  // Falhas do banco, com nome.
  //
  // Antes todas elas chegavam aqui como `server_error`, e a tela dava um
  // conselho errado justamente para a mais provável: a cota diária não volta
  // "em instantes", volta de madrugada. Quem lê esta tela é o investidor,
  // então o texto fala de limite de acessos e não de planos do Firebase — o
  // detalhe técnico fica no registro da função, para o administrador.
  firestore_quota: 'O sistema atingiu o limite diário de acessos ao banco de dados. '
    + 'Ele volta a funcionar de madrugada, por volta das 4h. Avise o administrador.',
  firestore_permission: 'O banco de dados recusou o acesso. Avise o administrador.',
  firestore_unauthenticated: 'A credencial do servidor foi recusada. Avise o administrador.',
  firestore_indisponivel: 'O banco de dados está indisponível no momento. Tente de novo em instantes.',
  firestore_timeout: 'A consulta demorou demais e foi cancelada. Tente de novo.',
};

// A ULTIMA FATIA QUE CHEGOU, guardada no navegador DELE.
//
// POR QUE ISTO EXISTE
// -------------------
// Quando a cota diaria do criatorio acaba, o portal inteiro virava uma tela de
// "Link indisponivel". Quem paga por isso e o INVESTIDOR — um terceiro, que
// abriu o link dele e levou um erro sobre um limite que nao e problema dele.
//
// Abrir com o que ja se sabia, dizendo de quando e, e melhor que nao abrir.
// Se o numero esta atualizado ou nao e outra conversa; a tela em branco nao da
// nem essa escolha.
//
// ONDE MORA: localStorage do proprio investidor, na chave do token dele. Nao e
// cache compartilhado — o payload e por investidor, e servir o de um para o
// outro seria catastrofico. Por isso tambem o /api/portal continua com
// no-store: nada disso pode encostar em CDN.
const CHAVE_ESPELHO = (token) => `portal:ultimo:${token}`;

// FALHAS DE INFRAESTRUTURA — o servidor nao conseguiu responder.
//
// SO estas liberam a copia local. `token_not_found` e `invalid_token` NUNCA
// entram aqui, e isso e a parte que importa: um link revogado tem que parar de
// funcionar na hora, e nao continuar abrindo do cache do navegador de quem ja
// tinha aberto antes. Codigo desconhecido tambem nao entra — o padrao e falhar
// fechado.
const FALHAS_DE_INFRA = new Set([
  'firestore_quota',
  'firestore_indisponivel',
  'firestore_timeout',
  'firestore_permission',
  'firestore_unauthenticated',
  'server_error',
  'network_error',
]);

function guardarEspelho(token, dados) {
  try {
    localStorage.setItem(CHAVE_ESPELHO(token), JSON.stringify({
      em: new Date().toISOString(),
      dados,
    }));
  } catch {
    // Sem espaco ou storage bloqueado. Perde-se a rede de seguranca, nao a tela.
  }
}

function lerEspelho(token) {
  try {
    const cru = localStorage.getItem(CHAVE_ESPELHO(token));
    if (!cru) return null;
    const { em, dados } = JSON.parse(cru);
    return dados ? { em, dados } : null;
  } catch {
    return null;
  }
}

function dataCurtaBR(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function Conteudo() {
  const { token } = useParams();
  const [estado, setEstado] = useState({ carregando: true, dados: null, erro: null, deQuando: null });
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
          cair(corpo.error || 'server_error');
          return;
        }
        guardarEspelho(token, corpo);
        setEstado({ carregando: false, dados: corpo, erro: null, deQuando: null });
      })
      .catch(() => {
        if (!cancelado) cair('network_error');
      });

    // O servidor nao respondeu. Se a falha for de infraestrutura E houver uma
    // copia local, abre com ela — datada. Senao, a tela de erro de sempre.
    function cair(erro) {
      const espelho = FALHAS_DE_INFRA.has(erro) ? lerEspelho(token) : null;
      if (espelho) {
        setEstado({ carregando: false, dados: espelho.dados, erro: null, deQuando: espelho.em });
        return;
      }
      setEstado({ carregando: false, dados: null, erro, deQuando: null });
    }
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
    // As vendas saíram de dentro da Vitrine e viraram página própria. Entram
    // aqui para o investidor não PERDER o que já via: antes da divisão, a
    // metade de baixo da Vitrine mostrava as vendas dele. E é o dado mais
    // direto que ele tem — é dali que sai o pagamento.
    { to: `${base}/vendas-ornabird`, icon: <ShoppingCart />, label: 'Vendas' },
  ];

  return (
    <PortalAppProvider payload={estado.dados} loading={false} error={null}>
      <div className="app-layout">
        {/* A DATA E OBRIGATORIA quando os dados vem da copia local.
            Mostrar numeros antigos sem dizer que sao antigos e pior do que nao
            mostrar nada: o investidor confere o lucro dele achando que e o de
            hoje. Com a data, ele ve o que tem e sabe o que esta vendo. */}
        {estado.deQuando && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
            background: '#fef3c7', color: '#92400e', borderBottom: '1px solid #f59e0b',
            padding: '8px 16px', fontSize: 13, textAlign: 'center',
          }}>
            Mostrando os dados de <strong>{dataCurtaBR(estado.deQuando)}</strong> —
            o sistema está temporariamente sem acesso ao banco e não deu para atualizar agora.
          </div>
        )}
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
            <Route path="vendas-ornabird" element={<VendasOrnabird />} />
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
