import { initializeApp } from 'firebase/app';
import {
  getFirestore, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore';
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

// CACHE LOCAL — o que separa "ler tudo todo dia" de "ler so o que mudou".
//
// Na web a persistencia vem DESLIGADA por padrao, e a documentacao do Firestore
// e explicita sobre o preco disso: sem ela, "you will be charged for documents
// and index entries read as if you had issued a brand-new query whenever the
// listener disconnects and reconnects".
//
// Cada listener aqui escuta uma colecao INTEIRA, e o espelho de vendas do
// Ornabird ja passa de mil e quinhentos documentos. Sem cache, cada F5 pagava
// tudo de novo — e a cota diaria gratuita (50 mil leituras) acabava em menos de
// vinte aberturas do app.
//
// Com o cache, o onSnapshot serve a copia local na hora (de graca) e reconecta
// com um marcador da ultima sincronizacao: o servidor manda so o que mudou
// desde entao. A tela abre instantanea e a fatura para de crescer com o
// tamanho do historico.
//
// `persistentMultipleTabManager` porque o dono deixa o Invest aberto em mais de
// uma aba. Sem ele, so a primeira aba ganha cache e as outras voltam a pagar
// tudo — o pior dos dois mundos, e silencioso.
function abrirFirestore() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Navegador sem IndexedDB (aba anonima, webview antiga) ou modulo ja
    // inicializado (recarga a quente no desenvolvimento). Sem cache o app
    // funciona igual — so mais caro. Nunca vale derrubar a tela por isso.
    return getFirestore(app);
  }
}

export const db = abrirFirestore();
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
