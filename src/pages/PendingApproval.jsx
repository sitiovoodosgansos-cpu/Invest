import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Bird, LogOut, Clock } from 'lucide-react';

export default function PendingApproval() {
  const { currentUser, logout } = useAuth();

  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <div className="login-header">
          <div className="login-logo">
            <Bird size={28} />
          </div>
          <h1>Sitio Voo dos Gansos</h1>
        </div>

        <div style={{ padding: '20px 0' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--warning-bg, #fff3cd)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Clock size={28} color="var(--warning-text, #856404)" />
          </div>
          <h3 style={{ marginBottom: 8 }}>Conta criada com sucesso!</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
            Ola, <strong>{currentUser?.displayName}</strong>! Sua conta esta aguardando aprovacao do administrador.
            Voce recebera acesso ao painel assim que for aprovado.
          </p>
        </div>

        <button className="btn btn-secondary login-btn" onClick={logout} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <LogOut size={16} /> Sair
        </button>

        <p className="login-footer">
          v1.0 - Sitio Voo dos Gansos
        </p>
      </div>
    </div>
  );
}
