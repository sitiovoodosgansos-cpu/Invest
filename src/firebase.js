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
// O cache pegou? Isto NAO e curiosidade tecnica.
//
// Sem cache, cada abertura de cada aba paga a leitura inteira de novo — e o
// plano gratuito tem teto de 50 mil leituras POR DIA. Cair no `catch` abaixo e
// a diferenca entre o app funcionar e o dono ficar trancado do lado de fora ate
// as 4h da manha. Falhar em silencio aqui e caro demais: quem investiga amanha
// nao tem como saber se o cache estava ligado ontem.
export let cacheLocalAtivo = false;
export let cacheLocalMotivo = '';

function abrirFirestore() {
  try {
    const fs = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    cacheLocalAtivo = true;
    return fs;
  } catch (err) {
    // Navegador sem IndexedDB (aba anonima, webview antiga) ou modulo ja
    // inicializado (recarga a quente no desenvolvimento). Nunca vale derrubar a
    // tela por isso — mas tambem nao vale esconder.
    cacheLocalMotivo = err?.code || err?.message || 'motivo desconhecido';
    // console de propósito, e nao devWarn: em producao e onde o problema mora.
    console.warn(
      '[invest] Cache local do Firestore NAO ligou:', cacheLocalMotivo,
      '— cada abertura vai reler tudo e a cota diaria pode acabar antes do fim do dia.'
    );
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
