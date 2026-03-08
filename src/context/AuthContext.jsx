import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext();

const AUTH_KEY = 'sitio_voo_dos_gansos_auth';
const ADMIN_KEY = 'sitio_voo_dos_gansos_admin';

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = sessionStorage.getItem(AUTH_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const getAdmin = () => {
    try {
      const stored = localStorage.getItem(ADMIN_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  };

  const setupAdmin = (username, password) => {
    const admin = { username, password, role: 'admin' };
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    setCurrentUser(admin);
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(admin));
  };

  const login = (username, password, investors) => {
    const admin = getAdmin();

    // Check admin credentials
    if (admin && admin.username === username && admin.password === password) {
      const user = { ...admin, role: 'admin' };
      setCurrentUser(user);
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(user));
      return { success: true, user };
    }

    // Check investor credentials
    const investor = investors.find(
      i => i.loginUsername === username && i.loginPassword === password
    );
    if (investor) {
      const user = { role: 'investor', investorId: investor.id, name: investor.name };
      setCurrentUser(user);
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(user));
      return { success: true, user };
    }

    return { success: false, error: 'Usuario ou senha incorretos' };
  };

  const logout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem(AUTH_KEY);
  };

  const isAdmin = currentUser?.role === 'admin';
  const isInvestor = currentUser?.role === 'investor';
  const adminExists = !!getAdmin();

  return (
    <AuthContext.Provider value={{
      currentUser, isAdmin, isInvestor, adminExists,
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
