import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Bird, LogIn, UserPlus, Eye, EyeOff, ArrowLeft } from 'lucide-react';

export default function Login() {
  const { adminExists, login, setupAdmin } = useAuth();
  const { investors } = useApp();
  // 'welcome' = initial screen with 2 buttons, 'login' = login form, 'setup' = create admin
  const [screen, setScreen] = useState('welcome');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const resetForm = () => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setShowPassword(false);
  };

  const goTo = (s) => {
    resetForm();
    setScreen(s);
  };

  const [loginLoading, setLoginLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoginLoading(true);
    try {
      const result = await login(username, password, investors);
      if (!result.success) {
        setError(result.error);
      }
    } catch {
      setError('Erro ao conectar. Tente novamente.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSetup = (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) {
      setError('Digite um nome de usuario');
      return;
    }
    if (password.length < 4) {
      setError('A senha deve ter pelo menos 4 caracteres');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas nao coincidem');
      return;
    }
    setupAdmin(username, password);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <Bird size={28} />
          </div>
          <h1>Sitio Voo dos Gansos</h1>
          <p>
            {screen === 'setup' ? 'Configure o acesso do administrador' :
             screen === 'login' ? 'Entre com suas credenciais' :
             'Sistema de Investimentos'}
          </p>
        </div>

        {error && (
          <div className="login-error">{error}</div>
        )}

        {screen === 'welcome' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              className="btn btn-primary login-btn"
              onClick={() => goTo('login')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <LogIn size={18} /> Entrar
            </button>
            <button
              className="btn btn-secondary login-btn"
              onClick={() => goTo('setup')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <UserPlus size={18} /> Novo Usuario
            </button>
          </div>
        )}

        {screen === 'login' && (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Usuario</label>
              <input
                className="form-input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Seu usuario"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Senha</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Sua senha"
                  style={{ paddingRight: 40 }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', padding: 4, cursor: 'pointer' }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button type="submit" className="btn btn-primary login-btn" disabled={loginLoading}>
              <LogIn size={18} /> {loginLoading ? 'Conectando...' : 'Entrar'}
            </button>
            <p style={{ textAlign: 'center', marginTop: 12 }}>
              <button type="button" onClick={() => goTo('welcome')} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ArrowLeft size={14} /> Voltar
              </button>
            </p>
          </form>
        )}

        {screen === 'setup' && (
          <form onSubmit={handleSetup}>
            {adminExists && (
              <div style={{ background: 'var(--warning-bg, #fff3cd)', color: 'var(--warning-text, #856404)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16, border: '1px solid var(--warning-border, #ffc107)' }}>
                Ja existe um administrador configurado. Se voce e investidor, clique em "Voltar" e use "Entrar".
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Usuario Administrador</label>
              <input
                className="form-input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Senha</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Crie uma senha"
                  style={{ paddingRight: 40 }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', padding: 4, cursor: 'pointer' }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Confirmar Senha</label>
              <input
                className="form-input"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
              />
            </div>
            <button type="submit" className="btn btn-primary login-btn">
              <UserPlus size={18} /> Criar Conta Admin
            </button>
            <p style={{ textAlign: 'center', marginTop: 12 }}>
              <button type="button" onClick={() => goTo('welcome')} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ArrowLeft size={14} /> Voltar
              </button>
            </p>
          </form>
        )}

        <p className="login-footer">
          v1.0 - Sitio Voo dos Gansos
        </p>
      </div>
    </div>
  );
}
