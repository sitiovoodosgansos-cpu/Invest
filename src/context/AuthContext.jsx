import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const AuthContext = createContext();

const AUTH_KEY = 'sitio_voo_dos_gansos_auth';
const ADMIN_KEY = 'sitio_voo_dos_gansos_admin';
const FIRESTORE_ADMIN_DOC = doc(db, 'config', 'admin');

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    // Auto-login como admin para testes
    return { username: 'Edu', password: 'Gansopardo', role: 'admin' };
  });

  const [adminData, setAdminData] = useState(null);
  const [adminLoading, setAdminLoading] = useState(true);

  // Load admin from Firestore on startup
  useEffect(() => {
    const loadAdmin = async () => {
      try {
        const snapshot = await getDoc(FIRESTORE_ADMIN_DOC);
        if (snapshot.exists()) {
          setAdminData(snapshot.data());
        } else {
          // Try to migrate from localStorage
          const stored = localStorage.getItem(ADMIN_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            await setDoc(FIRESTORE_ADMIN_DOC, parsed);
            setAdminData(parsed);
          }
        }
      } catch (error) {
        console.error('Firestore admin load error:', error);
        // Fallback to localStorage
        try {
          const stored = localStorage.getItem(ADMIN_KEY);
          if (stored) setAdminData(JSON.parse(stored));
        } catch {
          // ignore
        }
      }
      setAdminLoading(false);
    };
    loadAdmin();
  }, []);

  const getAdmin = () => adminData;

  const setupAdmin = async (username, password) => {
    const admin = { username, password, role: 'admin' };
    // Save to Firestore and localStorage (backup)
    try {
      await setDoc(FIRESTORE_ADMIN_DOC, admin);
    } catch (error) {
      console.error('Firestore admin save error:', error);
    }
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    setAdminData(admin);
    setCurrentUser(admin);
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(admin));
  };

  const login = (username, password, investors) => {
    const u = username.trim();
    const p = password.trim();
    const admin = getAdmin();

    // Check admin credentials
    if (admin && admin.username === u && admin.password === p) {
      const user = { ...admin, role: 'admin' };
      setCurrentUser(user);
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(user));
      return { success: true, user };
    }

    // Check investor credentials
    const investor = investors.find(
      i => i.loginUsername?.trim() === u && i.loginPassword?.trim() === p
    );
    if (investor) {
      const user = { role: 'investor', investorId: investor.id, name: investor.name };
      setCurrentUser(user);
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(user));
      return { success: true, user };
    }

    // More specific error when data might not have loaded
    if (!investors || investors.length === 0) {
      return { success: false, error: 'Dados ainda carregando. Aguarde e tente novamente.' };
    }

    // Debug: show available logins (first 2 chars only) to help diagnose
    const availableLogins = investors
      .filter(i => i.loginUsername)
      .map(i => i.loginUsername.trim().substring(0, 3) + '...')
      .join(', ');

    return {
      success: false,
      error: availableLogins
        ? `Usuario ou senha incorretos. Logins disponiveis: ${availableLogins}`
        : `Usuario ou senha incorretos. Nenhum investidor tem login configurado (${investors.length} investidores encontrados).`
    };
  };

  const logout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem(AUTH_KEY);
  };

  const isAdmin = currentUser?.role === 'admin';
  const isInvestor = currentUser?.role === 'investor';
  const adminExists = !!adminData;

  return (
    <AuthContext.Provider value={{
      currentUser, isAdmin, isInvestor, adminExists, adminLoading,
      login, logout, setupAdmin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
