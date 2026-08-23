import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { auth, db, synthesizeEmail } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { hashPassword, verifyPassword } from '../utils/crypto';

const AuthContext = createContext();

// sessionStorage key for the investor-side session. Investors do NOT use
// Firebase Auth in Phase 2A — only the admin does. Investor login is verified
// client-side against the hashed credential stored on the investor record in
// /config/appData, and the resulting session is kept locally.
const INVESTOR_SESSION_KEY = 'sitio_voo_dos_gansos_investor_session';

// Legacy localStorage backup of the /config/admin doc. Used as a last-resort
// fallback when Firestore is unreachable at boot.
const ADMIN_KEY = 'sitio_voo_dos_gansos_admin';

const FIRESTORE_ADMIN_DOC = doc(db, 'config', 'admin');
const USER_DOC = (uid) => doc(db, 'users', uid);

// Firebase Auth errors that mean "this credential isn't in Firebase Auth yet".
// Any one of these triggers the legacy-credential fallback + transparent
// migration path on first login after the Phase 2 rollout.
const LEGACY_FALLBACK_ERRORS = new Set([
  'auth/user-not-found',
  'auth/wrong-password',
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
]);

// POR QUE O LOGIN PRECISA DE UM MOTIVO
//
// O papel do usuario nao vem do Firebase Auth: vem de /users/{uid}, lido logo
// depois de entrar. Quando essa leitura falha — cota do dia estourada, regra
// recusando, rede caindo —, o codigo antigo fazia `setAdminUserDoc(null)` e
// seguia calado. Do lado de fora: o Entrar funciona, o Firebase aceita a
// senha, e a tela de login continua exatamente igual. "Clico no botao e nao
// faz nada."
//
// O SDK do navegador devolve `code` em TEXTO (diferente do firebase-admin no
// servidor, que devolve numero). Cada um destes vira uma frase que diz o que
// aconteceu e o que fazer.
const MOTIVOS_FIRESTORE = {
  'resource-exhausted':
    'O banco de dados atingiu o limite diario de acessos. Sua senha esta certa — o que faltou foi ler o seu perfil. O limite zera de madrugada, por volta das 4h.',
  'permission-denied':
    'O banco de dados recusou a leitura do seu perfil. As regras de seguranca do Firestore precisam ser revistas.',
  unavailable:
    'Nao foi possivel falar com o banco de dados agora. Verifique a conexao e tente de novo.',
  unauthenticated:
    'A credencial do aplicativo foi recusada pelo banco de dados.',
  'deadline-exceeded':
    'O banco de dados demorou demais para responder. Tente de novo.',
};

function motivoDoErro(err) {
  const code = String(err?.code || '').replace(/^firestore\//, '');
  return MOTIVOS_FIRESTORE[code]
    || `Nao foi possivel carregar o seu perfil de acesso${code ? ` (${code})` : ''}.`;
}

export function AuthProvider({ children }) {
  // O MOTIVO da ultima falha de acesso, para a tela de login poder dizer.
  //
  // Sem isto, toda falha de leitura do perfil terminava numa tela de login
  // que nao mudava e nao explicava nada.
  const [authError, setAuthError] = useState(null);
  // Firebase Auth state. Populated by onAuthStateChanged.
  const [firebaseUser, setFirebaseUser] = useState(null); // eslint-disable-line no-unused-vars
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);

  // /config/admin legacy doc. Used as a "does an admin exist?" signal and as
  // the source of truth for the admin username during first-login migration.
  const [legacyAdminDoc, setLegacyAdminDoc] = useState(null);
  const [legacyAdminLoaded, setLegacyAdminLoaded] = useState(false);

  // /users/{uid} doc for the currently-signed-in Firebase Auth user. Only
  // populated when the signed-in user is the admin.
  const [adminUserDoc, setAdminUserDoc] = useState(null);

  // Investor session. Independent of Firebase Auth — it lives in sessionStorage
  // and carries only non-sensitive identifying data (investorId, display name).
  const [investorSession, setInvestorSession] = useState(() => {
    try {
      const stored = sessionStorage.getItem(INVESTOR_SESSION_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  // Remembered at login() time so that onAuthStateChanged can seed the
  // admin user doc optimistically while waiting for the /users/{uid} write
  // to round-trip through Firestore.
  const pendingAdminUsername = useRef(null);

  // 1) Load the legacy /config/admin doc at boot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await getDoc(FIRESTORE_ADMIN_DOC);
        if (cancelled) return;
        if (snapshot.exists()) {
          setLegacyAdminDoc(snapshot.data());
        } else {
          // First-run or Firestore temporarily offline. Try the localStorage
          // backup so we at least remember whether an admin was ever created.
          try {
            const stored = localStorage.getItem(ADMIN_KEY);
            if (stored) setLegacyAdminDoc(JSON.parse(stored));
          } catch {
            // ignore
          }
        }
      } catch {
        try {
          const stored = localStorage.getItem(ADMIN_KEY);
          if (!cancelled && stored) setLegacyAdminDoc(JSON.parse(stored));
        } catch {
          // ignore
        }
      } finally {
        if (!cancelled) setLegacyAdminLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 2) Track Firebase Auth state and resolve the /users/{uid} doc.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setAdminUserDoc(null);
        setFirebaseAuthReady(true);
        return;
      }
      try {
        const snapshot = await getDoc(USER_DOC(user.uid));
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data.role === 'admin') {
            setAdminUserDoc({ uid: user.uid, ...data });
            // Entrou de verdade: qualquer motivo antigo deixa de valer.
            setAuthError(null);
          } else {
            // Unexpected role — fail closed, mas dizendo por que.
            setAdminUserDoc(null);
            setAuthError(
              'A sua conta existe, mas nao esta marcada como administrador. '
              + 'Avise quem administra o sistema.'
            );
            await signOut(auth);
          }
        } else if (pendingAdminUsername.current) {
          // The /users/{uid} write is racing with onAuthStateChanged. Seed
          // the admin doc optimistically from the pending username so the UI
          // doesn't flicker between "not logged in" and "logged in".
          setAdminUserDoc({
            uid: user.uid,
            role: 'admin',
            username: pendingAdminUsername.current,
          });
        } else {
          // Usuario autenticado no Firebase mas SEM /users/{uid}. Acontece
          // quando a gravacao desse documento falhou numa entrada anterior —
          // o ensureAdminUserDoc engole a falha de proposito. Fecha o acesso,
          // mas agora explica, senao vira uma tela de login que nao reage.
          setAdminUserDoc(null);
          setAuthError(
            'A sua senha foi aceita, mas o seu perfil de acesso nao foi '
            + 'encontrado. Isso acontece quando o banco de dados esteve fora '
            + 'do ar em algum acesso anterior. Tente entrar de novo; se '
            + 'persistir, avise quem administra o sistema.'
          );
          await signOut(auth);
        }
      } catch (err) {
        // O CAMINHO QUE DEIXAVA A TELA MUDA. A senha foi aceita pelo Firebase
        // Auth, mas o perfil nao pode ser lido — e sem perfil o app volta pra
        // tela de login. Sem esta mensagem, o botao parecia nao fazer nada.
        setAdminUserDoc(null);
        setAuthError(motivoDoErro(err));
      } finally {
        setFirebaseAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  // Write the /users/{uid} admin profile. The Phase 2A Firestore rules allow
  // a caller to self-create this doc on first login (request.auth.uid == uid).
  const writeAdminUserDoc = async (uid, username) => {
    await setDoc(USER_DOC(uid), {
      role: 'admin',
      username,
      createdAt: new Date().toISOString(),
    });
  };

  // Make sure /users/{uid} exists for the signed-in admin. Called after every
  // successful sign-in as a self-healing step: if the doc was lost or never
  // written (e.g. failed first-login write), we write it now.
  const ensureAdminUserDoc = async (uid, username) => {
    try {
      const snap = await getDoc(USER_DOC(uid));
      if (!snap.exists()) {
        await writeAdminUserDoc(uid, username);
      }
    } catch {
      // Best-effort — onAuthStateChanged will retry on next boot.
    }
  };

  // First-run setup: create the Firebase Auth account AND mirror the
  // credential into /config/admin so the adminExists signal keeps working.
  const setupAdmin = async (username, password) => {
    const u = (username || '').trim();
    const email = synthesizeEmail(u);
    if (!email) throw new Error('Usuario invalido.');

    pendingAdminUsername.current = u;

    // 1) Create the Firebase Auth account.
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
    } catch (e) {
      if (e?.code === 'auth/operation-not-allowed') {
        throw new Error(
          'Firebase Authentication ainda nao esta habilitado. Habilite Email/Password em Firebase Console > Authentication > Sign-in method.'
        );
      }
      if (e?.code === 'auth/weak-password') {
        throw new Error('A senha e muito fraca. Use pelo menos 8 caracteres.');
      }
      if (e?.code === 'auth/email-already-in-use') {
        throw new Error('Ja existe um administrador configurado.');
      }
      throw new Error('Erro ao configurar administrador. Tente novamente.');
    }

    // 2) Write /users/{uid} with role=admin.
    try {
      await writeAdminUserDoc(cred.user.uid, u);
    } catch {
      // Even if this fails the admin can still sign in; the next login will
      // retry via ensureAdminUserDoc. No need to abort setup here.
    }

    // 3) Mirror the credential to /config/admin (legacy signal). The rules
    // allow create-once, so subsequent runs skip this.
    try {
      const hashed = await hashPassword(password);
      const legacyPayload = { username: u, password: hashed, role: 'admin' };
      await setDoc(FIRESTORE_ADMIN_DOC, legacyPayload);
      localStorage.setItem(ADMIN_KEY, JSON.stringify(legacyPayload));
      setLegacyAdminDoc(legacyPayload);
    } catch {
      // The legacy doc is a convenience, not a hard dependency.
    }

    // Seed UI state so the admin panel renders without waiting for the
    // round-trip.
    setAdminUserDoc({ uid: cred.user.uid, role: 'admin', username: u });
  };

  // login() is async. Returns one of:
  //   { success: true, role: 'admin' }
  //   { success: true, role: 'investor', investorId, legacyInvestorId? }
  //   { success: false, error }
  //
  // legacyInvestorId is set when an investor logged in with a plaintext
  // password that should be re-hashed. The caller is expected to attempt
  // updateInvestor(legacyInvestorId, { loginPassword: <new hash> }). Under
  // Phase 2A rules that write will be blocked unless the caller is an admin,
  // so the upgrade is best-effort only.
  const login = async (username, password, investors) => {
    const u = (username || '').trim();
    const p = (password || '').trim();
    if (!u || !p) {
      return { success: false, error: 'Usuario ou senha incorretos.' };
    }

    // ---------- Admin path ----------
    const legacy = legacyAdminDoc;
    if (legacy && (legacy.username || '').trim() === u) {
      const email = synthesizeEmail(u);
      if (!email) return { success: false, error: 'Usuario ou senha incorretos.' };

      // Set the pending username BEFORE sign-in so the onAuthStateChanged
      // handler can seed state optimistically.
      pendingAdminUsername.current = u;

      // First try: native Firebase Auth.
      try {
        const cred = await signInWithEmailAndPassword(auth, email, p);
        await ensureAdminUserDoc(cred.user.uid, u);
        return { success: true, role: 'admin' };
      } catch (e) {
        const code = e?.code || '';
        if (code === 'auth/operation-not-allowed') {
          return {
            success: false,
            error: 'Firebase Authentication ainda nao esta habilitado. Contate o administrador do sistema.',
          };
        }
        if (!LEGACY_FALLBACK_ERRORS.has(code)) {
          // Network / internal errors — don't leak details.
          return { success: false, error: 'Erro ao entrar. Tente novamente.' };
        }
        // Fall through to the legacy fallback below.
      }

      // Legacy verification against the /config/admin hashed credential.
      try {
        const result = await verifyPassword(p, legacy.password);
        if (!result.ok) {
          return { success: false, error: 'Usuario ou senha incorretos.' };
        }
      } catch {
        return { success: false, error: 'Usuario ou senha incorretos.' };
      }

      // Legacy credential was valid — transparently migrate the admin to
      // Firebase Auth. From this point on, this admin uses Firebase Auth.
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, p);
        await ensureAdminUserDoc(cred.user.uid, u);
        return { success: true, role: 'admin' };
      } catch (e) {
        if (e?.code === 'auth/email-already-in-use') {
          // Another tab or device already migrated this admin. Try signing in
          // again — this time the account exists.
          try {
            const cred = await signInWithEmailAndPassword(auth, email, p);
            await ensureAdminUserDoc(cred.user.uid, u);
            return { success: true, role: 'admin' };
          } catch {
            return { success: false, error: 'Erro ao entrar. Tente novamente.' };
          }
        }
        if (e?.code === 'auth/operation-not-allowed') {
          return {
            success: false,
            error: 'Firebase Authentication ainda nao esta habilitado. Contate o administrador do sistema.',
          };
        }
        if (e?.code === 'auth/weak-password') {
          return {
            success: false,
            error: 'Sua senha atual nao atende aos novos requisitos. Contate o administrador para redefinir.',
          };
        }
        return { success: false, error: 'Erro ao entrar. Tente novamente.' };
      }
    }

    // ---------- Investor path ----------
    if (Array.isArray(investors)) {
      for (const investor of investors) {
        if ((investor.loginUsername || '').trim() !== u) continue;
        const stored = investor.loginPassword;
        const normalizedStored = typeof stored === 'string' ? stored.trim() : stored;
        const result = await verifyPassword(p, normalizedStored);
        if (result.ok) {
          const session = {
            role: 'investor',
            investorId: investor.id,
            name: investor.name,
          };
          setInvestorSession(session);
          sessionStorage.setItem(INVESTOR_SESSION_KEY, JSON.stringify(session));
          return {
            success: true,
            role: 'investor',
            investorId: investor.id,
            legacyInvestorId: result.needsUpgrade ? investor.id : null,
          };
        }
      }
    }

    if (!investors || investors.length === 0) {
      return {
        success: false,
        error: 'Nao foi possivel entrar. Verifique sua conexao e tente novamente.',
      };
    }
    return { success: false, error: 'Usuario ou senha incorretos.' };
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    setInvestorSession(null);
    sessionStorage.removeItem(INVESTOR_SESSION_KEY);
    pendingAdminUsername.current = null;
  };

  // Derive the public-facing currentUser. Downstream components only care
  // about {role, username?, investorId?, name?}.
  let currentUser = null;
  if (adminUserDoc) {
    currentUser = { role: 'admin', username: adminUserDoc.username };
  } else if (investorSession) {
    currentUser = investorSession;
  }

  const isAdmin = currentUser?.role === 'admin';
  const isInvestor = currentUser?.role === 'investor';
  const adminExists = !!legacyAdminDoc;
  const adminLoading = !firebaseAuthReady || !legacyAdminLoaded;

  return (
    <AuthContext.Provider value={{
      currentUser, isAdmin, isInvestor, adminExists, adminLoading,
      authError,
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
