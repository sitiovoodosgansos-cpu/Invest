import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, getDocs } from 'firebase/firestore';

const googleProvider = new GoogleAuthProvider();

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile = null;

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      // Clean up previous profile listener
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (firebaseUser) {
        // Listen to user profile in Firestore
        const userRef = doc(db, 'users', firebaseUser.uid);
        unsubProfile = onSnapshot(userRef, (snapshot) => {
          if (snapshot.exists()) {
            setCurrentUser({ uid: firebaseUser.uid, email: firebaseUser.email, ...snapshot.data() });
          } else {
            // Profile doc doesn't exist yet (shouldn't happen normally)
            setCurrentUser({ uid: firebaseUser.uid, email: firebaseUser.email, role: 'investor', approved: false });
          }
          setLoading(false);
        }, () => {
          // Error reading profile
          setCurrentUser({ uid: firebaseUser.uid, email: firebaseUser.email, role: 'investor', approved: false });
          setLoading(false);
        });
      } else {
        setCurrentUser(null);
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const login = async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const register = async (email, password, displayName) => {
    // Check if this is the first user (becomes admin)
    const usersSnap = await getDocs(collection(db, 'users'));
    const isFirstUser = usersSnap.empty;

    const cred = await createUserWithEmailAndPassword(auth, email, password);

    await setDoc(doc(db, 'users', cred.user.uid), {
      uid: cred.user.uid,
      email,
      displayName,
      role: isFirstUser ? 'admin' : 'investor',
      approved: isFirstUser ? true : false,
      investorId: null,
      createdAt: new Date().toISOString(),
      approvedAt: isFirstUser ? new Date().toISOString() : null,
    });
  };

  const loginWithGoogle = async () => {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;

    // Check if user profile already exists
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      // New user via Google - create profile
      const usersSnap = await getDocs(collection(db, 'users'));
      const isFirstUser = usersSnap.empty;

      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email,
        role: isFirstUser ? 'admin' : 'investor',
        approved: isFirstUser ? true : false,
        investorId: null,
        createdAt: new Date().toISOString(),
        approvedAt: isFirstUser ? new Date().toISOString() : null,
      });
    }
  };

  const logout = () => signOut(auth);

  const isAdmin = currentUser?.role === 'admin' && currentUser?.approved;
  const isInvestor = currentUser?.role === 'investor' && currentUser?.approved;
  const isPending = currentUser?.role === 'investor' && !currentUser?.approved;

  return (
    <AuthContext.Provider value={{
      currentUser, loading, isAdmin, isInvestor, isPending,
      login, register, loginWithGoogle, logout,
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
