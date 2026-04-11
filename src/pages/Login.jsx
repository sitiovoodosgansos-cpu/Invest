import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { hashPassword } from '../utils/crypto';
import { Bird, LogIn, UserPlus, Eye, EyeOff, AlertTriangle } from 'lucide-react';

export default function Login() {
  const { adminExists, login, setupAdmin } = useAuth();
  const { investors, firestoreError, updateInvestor } = useApp();
  // Always show login form by default - never show setup automatically
  const [showSetup, setShowSetup] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Only allow setup if admin doesn't exist AND user explicitly requested it
  const isSetup = showSetup && !adminExists;

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    if (firestoreError && (!investors || investors.length === 0)) {
      setError('Nao foi possivel carregar os dados. Verifique sua conexao ou entre em contato com o administrador.');
      return;
    }
    try {
      const result = await login(username, password, investors);
      if (!result.success) {
        setError(result.error);
        return;
      }
      // Silently upgrade legacy plaintext investor passwords to a hash on first
      // successful login after the security rollout.
      if (result.legacyInvestorId) {
        try {
          const newHash = await hashPassword(password.trim());
          updateInvestor(result.legacyInvestorId, { loginPassword: newHash });
        } catch {
          // Do not block login on upgrade failure.
        }
      }
    } catch {
      setError('Erro ao fazer login. Tente novamente.');
    }
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) {
      setError('Digite um nome de usuario');
      return;
    }
    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres');
      return;
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('A senha deve conter pelo menos uma letra e um numero');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas nao coincidem');
      return;
    }
    try {
      await setupAdmin(username, password);
    } catch (err) {
      // setupAdmin surfaces user-actionable messages (e.g. "Firebase Auth
      // nao habilitado"). Fall back to a generic message if none was set.
      setError(err?.message || 'Erro ao configurar administrador. Tente novamente.');
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
          <p>{isSetup ? 'Configure o acesso do administrador' : 'Sistema de Investimentos'}</p>
        </div>

        {firestoreError && (
          <div style={{ padding: '10px 14px', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#856404', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong>Erro de conexao com o banco de dados.</strong><br />
              Verifique sua conexao ou entre em contato com o administrador.
            </div>
          </div>
        )}

        {error && (
          <div className="login-error">{error}</div>
        )}

        {isSetup ? (
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
            <p style={{ textAlign: 'center', marginTop: 12, fontSize: 13 }}>
              <button type="button" onClick={() => { setShowSetup(false); setError(''); }} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}>
                Ja tenho conta, fazer login
              </button>
            </p>
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
          <br />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {firestoreError ? '⚠ Offline' : '✓ Online'}
          </span>
        </p>
      </div>
    </div>
  );
}
