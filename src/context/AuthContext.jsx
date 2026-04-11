import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { hashPassword, verifyPassword } from '../utils/crypto';

const AuthContext = createContext();

const AUTH_KEY = 'sitio_voo_dos_gansos_auth';
const ADMIN_KEY = 'sitio_voo_dos_gansos_admin';
const FIRESTORE_ADMIN_DOC = doc(db, 'config', 'admin');

// Remove sensitive fields before storing a user in sessionStorage.
// We never want the password hash to live in sessionStorage (where any XSS
// or browser-extension can read it).
const publicUser = (user) => {
  if (!user) return null;
  const { password, ...rest } = user; // eslint-disable-line no-unused-vars
  return rest;
};

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = sessionStorage.getItem(AUTH_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
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
      } catch {
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
    const hashed = await hashPassword(password);
    const admin = { username: username.trim(), password: hashed, role: 'admin' };
    // Save to Firestore and localStorage (backup)
    try {
      await setDoc(FIRESTORE_ADMIN_DOC, admin);
    } catch {
      // Keep localStorage backup even if Firestore fails
    }
    localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
    setAdminData(admin);
    const safeUser = publicUser(admin);
    setCurrentUser(safeUser);
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(safeUser));
  };

  // Persist an upgraded admin password hash (used when legacy plaintext is detected).
  const upgradeAdminPassword = async (newHash) => {
    const next = { ...adminData, password: newHash };
    try {
      await setDoc(FIRESTORE_ADMIN_DOC, next);
    } catch {
      // ignore
    }
    localStorage.setItem(ADMIN_KEY, JSON.stringify(next));
    setAdminData(next);
  };

  // login() is async because password verification uses the Web Crypto API.
  //
  // Returns:
  //   { success: true, user, legacyInvestorId? }
  //   { success: false, error }
  //
  // legacyInvestorId is set when an investor logged in with a plaintext
  // password that should be re-hashed. The caller is expected to call
  // updateInvestor(legacyInvestorId, { loginPassword: <new hash> }).
  const login = async (username, password, investors) => {
    const u = (username || '').trim();
    const p = (password || '').trim();
    if (!u || !p) {
      return { success: false, error: 'Usuario ou senha incorretos.' };
    }
    const admin = getAdmin();

    // Check admin credentials
    if (admin && admin.username === u) {
      const result = await verifyPassword(p, admin.password);
      if (result.ok) {
        // Silently upgrade legacy plaintext admin password to hash
        if (result.needsUpgrade) {
          try {
            const newHash = await hashPassword(p);
            await upgradeAdminPassword(newHash);
          } catch {
            // ignore upgrade errors — login still succeeds
          }
        }
        const safeUser = publicUser({ ...admin, role: 'admin' });
        setCurrentUser(safeUser);
        sessionStorage.setItem(AUTH_KEY, JSON.stringify(safeUser));
        return { success: true, user: safeUser };
      }
    }

    // Check investor credentials
    let matchedInvestor = null;
    let legacyInvestorId = null;
    if (Array.isArray(investors)) {
      for (const investor of investors) {
        if ((investor.loginUsername || '').trim() !== u) continue;
        const stored = investor.loginPassword;
        // Legacy plaintext investor credentials are stored as a trimmed string.
        const normalizedStored = typeof stored === 'string' ? stored.trim() : stored;
        const result = await verifyPassword(p, normalizedStored);
        if (result.ok) {
          matchedInvestor = investor;
          if (result.needsUpgrade) legacyInvestorId = investor.id;
          break;
        }
      }
    }

    if (matchedInvestor) {
      const user = { role: 'investor', investorId: matchedInvestor.id, name: matchedInvestor.name };
      setCurrentUser(user);
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(user));
      return { success: true, user, legacyInvestorId };
    }

    // Generic error to prevent user enumeration
    if (!investors || investors.length === 0) {
      return { success: false, error: 'Nao foi possivel entrar. Verifique sua conexao e tente novamente.' };
    }

    return { success: false, error: 'Usuario ou senha incorretos.' };
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
