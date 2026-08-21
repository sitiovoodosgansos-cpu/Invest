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
