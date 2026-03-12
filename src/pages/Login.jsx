import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Bird, LogIn, UserPlus, Eye, EyeOff, ArrowLeft } from 'lucide-react';

const AUTH_ERRORS = {
  'auth/email-already-in-use': 'Este email ja esta cadastrado',
  'auth/invalid-email': 'Email invalido',
  'auth/invalid-credential': 'Email ou senha incorretos',
  'auth/user-not-found': 'Email ou senha incorretos',
  'auth/wrong-password': 'Email ou senha incorretos',
  'auth/weak-password': 'A senha deve ter pelo menos 6 caracteres',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde um momento.',
  'auth/network-request-failed': 'Sem conexao. Verifique sua internet.',
};

function getErrorMessage(error) {
  return AUTH_ERRORS[error.code] || 'Erro ao processar. Tente novamente.';
}

export default function Login() {
  const { login, register } = useAuth();
  // 'welcome' | 'login' | 'register'
  const [screen, setScreen] = useState('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setDisplayName('');
    setError('');
    setShowPassword(false);
  };

  const goTo = (s) => {
    resetForm();
    setScreen(s);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (!displayName.trim()) {
      setError('Digite seu nome');
      return;
    }
    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas nao coincidem');
      return;
    }
    setSubmitting(true);
    try {
      await register(email, password, displayName.trim());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
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
            {screen === 'register' ? 'Crie sua conta' :
             screen === 'login' ? 'Entre com suas credenciais' :
             'Sistema de Investimentos'}
          </p>
        </div>

        {error && <div className="login-error">{error}</div>}

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
              onClick={() => goTo('register')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <UserPlus size={18} /> Criar Conta
            </button>
          </div>
        )}

        {screen === 'login' && (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
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
                  required
                  style={{ paddingRight: 40 }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', padding: 4, cursor: 'pointer' }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button type="submit" className="btn btn-primary login-btn" disabled={submitting}>
              <LogIn size={18} /> {submitting ? 'Entrando...' : 'Entrar'}
            </button>
            <p style={{ textAlign: 'center', marginTop: 12 }}>
              <button type="button" onClick={() => goTo('welcome')} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ArrowLeft size={14} /> Voltar
              </button>
            </p>
          </form>
        )}

        {screen === 'register' && (
          <form onSubmit={handleRegister}>
            <div className="form-group">
              <label className="form-label">Nome Completo</label>
              <input
                className="form-input"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Seu nome"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
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
                  placeholder="Minimo 6 caracteres"
                  required
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
                required
              />
            </div>
            <button type="submit" className="btn btn-primary login-btn" disabled={submitting}>
              <UserPlus size={18} /> {submitting ? 'Criando...' : 'Criar Conta'}
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
