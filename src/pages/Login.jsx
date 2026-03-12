import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Bird, LogIn, UserPlus, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const { adminExists, login, setupAdmin } = useAuth();
  const { investors } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const isSetup = !adminExists;

  const handleLogin = (e) => {
    e.preventDefault();
    setError('');
    const result = login(username, password, investors);
    if (!result.success) {
      setError(result.error);
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
          <p>{isSetup ? 'Configure o acesso do administrador' : 'Sistema de Investimentos'}</p>
        </div>

        {error && (
          <div className="login-error">{error}</div>
        )}

        {isSetup && !adminExists ? (
          <form onSubmit={handleSetup}>
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
          </form>
        ) : (
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
            <button type="submit" className="btn btn-primary login-btn">
              <LogIn size={18} /> Entrar
            </button>
          </form>
        )}

        <p className="login-footer">
          v1.0 - Sitio Voo dos Gansos
        </p>
      </div>
    </div>
  );
}
