import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, browserSessionPersistence, setPersistence } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBX-7B89aIYx7UghiEZeqdmF2DeQS4YaVE",
  authDomain: "sitio-voo-dos-gansos.firebaseapp.com",
  projectId: "sitio-voo-dos-gansos",
  storageBucket: "sitio-voo-dos-gansos.firebasestorage.app",
  messagingSenderId: "467417505201",
  appId: "1:467417505201:web:630578de172ec8f57bf190"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Session-scoped persistence: signs the admin out when the last tab closes.
// This matches the Phase 1 sessionStorage-based UX and shortens the window of
// exposure on a shared computer. If persistence can't be set (private mode,
// very old browser) Firebase falls back to in-memory auth, which is fine — we
// never promised durable sessions.
setPersistence(auth, browserSessionPersistence).catch(() => {
  // ignore — in-memory fallback is acceptable
});

// Build an internal e-mail address from an admin username.
//
// Admins never type an e-mail: they log in with just username + password. The
// e-mail exists only so Firebase Authentication can key the account.
//
// The ".invalid" TLD is reserved by RFC 2606 and is guaranteed never to
// resolve on the public internet, so no password-reset mail, verification
// mail, or any other side-effect message can ever escape to a real mailbox.
export const synthesizeEmail = (username) => {
  const cleaned = (username || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 64);
  if (!cleaned) return null;
  return `${cleaned}@internal.sitiovoodosgansos.invalid`;
};
