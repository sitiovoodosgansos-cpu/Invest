import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const AuthContext = createContext();

const AUTH_KEY = 'sitio_voo_dos_gansos_auth';
const ADMIN_KEY = 'sitio_voo_dos_gansos_admin';
const FIRESTORE_ADMIN_DOC = doc(db, 'config', 'admin');

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
  const [adminLoadFailed, setAdminLoadFailed] = useState(false);

  // Function to load admin from Firestore (reusable)
  const loadAdminFromFirestore = useCallback(async () => {
    try {
      const snapshot = await getDoc(FIRESTORE_ADMIN_DOC);
      if (snapshot.exists()) {
        const data = snapshot.data();
        setAdminData(data);
        // Cache in localStorage as backup
        localStorage.setItem(ADMIN_KEY, JSON.stringify(data));
        setAdminLoadFailed(false);
        return data;
      }
      // No admin doc exists in Firestore
      return null;
    } catch (error) {
      console.error('Firestore admin load error:', error);
      // Try localStorage fallback
      try {
        const stored = localStorage.getItem(ADMIN_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setAdminData(parsed);
          setAdminLoadFailed(false);
          return parsed;
        }
      } catch {
        // ignore
      }
      return null;
    }
  }, []);

  // Load admin on startup
  useEffect(() => {
    const init = async () => {
      const result = await loadAdminFromFirestore();
      if (!result) {
        // Check localStorage as last resort
        try {
          const stored = localStorage.getItem(ADMIN_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            setAdminData(parsed);
          } else {
            // No admin anywhere - could be first access or Firestore failed
            // Try one more time to confirm
            try {
              const snapshot = await getDoc(FIRESTORE_ADMIN_DOC);
              if (!snapshot.exists()) {
                // Truly no admin - first time setup
                setAdminLoadFailed(false);
              } else {
                setAdminData(snapshot.data());
              }
            } catch {
              setAdminLoadFailed(true);
            }
          }
        } catch {
          setAdminLoadFailed(true);
        }
      }
      setAdminLoading(false);
    };
    init();
  }, [loadAdminFromFirestore]);

  const getAdmin = () => adminData;

  const setupAdmin = async (username, password) => {
    const admin = { username, password, role: 'admin' };
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

  const login = async (username, password, investors) => {
    let admin = getAdmin();

    // If admin data is not loaded, try to fetch it from Firestore now
    if (!admin && adminLoadFailed) {
      try {
        const snapshot = await getDoc(FIRESTORE_ADMIN_DOC);
        if (snapshot.exists()) {
          admin = snapshot.data();
          setAdminData(admin);
          localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
          setAdminLoadFailed(false);
        }
      } catch (error) {
        console.error('Firestore retry failed:', error);
        return { success: false, error: 'Sem conexao com o servidor. Verifique sua internet e tente novamente.' };
      }
    }

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

    // Provide a more specific error when we couldn't load admin data
    if (!admin && adminLoadFailed) {
      return { success: false, error: 'Nao foi possivel conectar ao servidor. Tente novamente.' };
    }

    return { success: false, error: 'Usuario ou senha incorretos' };
  };

  const logout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem(AUTH_KEY);
  };

  const isAdmin = currentUser?.role === 'admin';
  const isInvestor = currentUser?.role === 'investor';
  const adminExists = !!adminData || adminLoadFailed;

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
