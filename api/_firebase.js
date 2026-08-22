// Inicializacao do firebase-admin e a checagem de administrador.
//
// Vive num arquivo separado porque tres rotas precisam disto (/api/ornabird,
// /api/ordens e a rotina diaria) e uma segunda copia da inicializacao
// divergiria: getApps() so protege contra inicializar duas vezes DENTRO do
// mesmo bundle, e cada funcao serverless da Vercel e um bundle proprio.
//
// O prefixo "_" no nome do arquivo e o que impede a Vercel de publicar isto
// como uma rota /api/_firebase.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

let cachedDb = null;

export function getFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    // Um codigo por variavel, em vez de um 'not_configured' generico. As
    // variaveis moram em lugares diferentes, e um erro que nao diz QUAL falta
    // custa um redeploy inteiro por palpite — foi o que aconteceu aqui.
    // Nome de variavel nao e segredo; o VALOR nunca sai daqui.
    const err = new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
    err.code = 'missing_firebase';
    throw err;
  }
  if (!getApps().length) {
    const creds = JSON.parse(raw);
    initializeApp({ credential: cert(creds), projectId: creds.project_id });
  }
  if (!cachedDb) cachedDb = getFirestore();
  return { db: cachedDb, auth: getAuth() };
}

// O codigo de erro em forma de texto, sempre.
//
// O firebase-admin devolve erro de gRPC com `code` NUMERICO. Toda a nossa
// tratativa de erro compara `code` com string, entao um numero atravessava tudo
// e virava "server_error" generico — e a tela dizia "falha antes de chegar ao
// Ornabird" para um problema que era do Firestore. O caso real foi o 8.
//
// 8 = RESOURCE_EXHAUSTED: a cota diaria do plano gratuito do Firestore acabou.
// E o erro mais provavel desta base, e o que menos parece com o que e: some
// tudo da tela sem nenhuma pista do motivo.
const GRPC = {
  8: 'firestore_quota',
  7: 'firestore_permission',
  16: 'firestore_unauthenticated',
  14: 'firestore_indisponivel',
  4: 'firestore_timeout',
};

export function codigoDoErro(err) {
  if (typeof err?.code === 'number') return GRPC[err.code] || `firestore_${err.code}`;
  if (err?.code === 'resource-exhausted') return 'firestore_quota';
  if (typeof err?.code === 'string' && err.code) return err.code;
  return null;
}

// Throws unless the caller is a signed-in admin.
export async function requireAdmin(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    const err = new Error('missing id token');
    err.code = 'unauthorized';
    throw err;
  }
  const { db, auth } = getFirebase();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(header.slice(7).trim());
  } catch {
    const err = new Error('invalid id token');
    err.code = 'unauthorized';
    throw err;
  }
  const snap = await db.collection('users').doc(decoded.uid).get();
  if (!snap.exists || snap.data()?.role !== 'admin') {
    const err = new Error('not an admin');
    err.code = 'forbidden';
    throw err;
  }
  return decoded.uid;
}
