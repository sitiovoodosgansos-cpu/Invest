// Server-side portal data endpoint.
//
// WHY THIS EXISTS
// ---------------
// The portals used to read Firestore straight from the browser and filter the
// result in JS. Because /config/appData, /sales and /eggCollections are
// world-readable, that meant every visitor received the ENTIRE database —
// every investor's CPF, password hash, portal token, financials and receipt
// images — and the "privacy" was purely cosmetic.
//
// This function moves the filtering to the server. It runs with the Firebase
// Admin SDK (which bypasses security rules by design), resolves the portal
// token itself, and returns ONLY the slice the caller is entitled to. Once the
// portals consume this endpoint, `allow read` on those collections can be
// locked down to admins and the exposure closes for good.
//
// SECURITY NOTES
// --------------
//   * The token arrives in the POST body, never in the URL, so it does not
//     land in access logs, browser history or Referer headers.
//   * Responses are marked no-store. A CDN caching one investor's payload and
//     serving it to another would be catastrophic, so caching is refused at
//     every layer.
//   * Nothing in the response identifies another investor. Bird ownership
//     history is stripped because its entries carry previous owners' ids.
//   * The service account key lives only in the FIREBASE_SERVICE_ACCOUNT
//     environment variable. It is never bundled into the browser.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { calculateProfitDistribution } from '../src/utils/helpers.js';

// Reuse the Admin app across warm invocations; initializing twice throws.
let cachedDb = null;
function getDb() {
  if (cachedDb) return cachedDb;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    const err = new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
    err.code = 'not_configured';
    throw err;
  }
  const creds = JSON.parse(raw);
  if (!getApps().length) {
    initializeApp({ credential: cert(creds), projectId: creds.project_id });
  }
  cachedDb = getFirestore();
  return cachedDb;
}

// Only the fields the investor portal actually renders. Everything else —
// document (CPF), loginUsername, loginPassword hash, portalTokenId — is
// deliberately dropped even for the investor's own record.
function publicInvestor(investor) {
  return {
    id: investor.id,
    name: investor.name || '',
    email: investor.email || '',
    phone: investor.phone || '',
  };
}

// Ownership history is removed: its entries carry the ids of previous owners,
// which would disclose that another investor exists and which animals moved.
// The server already resolved attribution, so the client never needs it.
function publicBird(bird, investorId) {
  return {
    id: bird.id,
    // Always the caller's own id (we only return birds they currently own),
    // so this discloses nothing while keeping the portal's filters working.
    investorId,
    species: bird.species || '',
    breed: bird.breed || '',
    matrixCount: bird.matrixCount ?? '',
    breederCount: bird.breederCount ?? '',
    investmentValue: bird.investmentValue ?? '',
    createdAt: bird.createdAt || '',
  };
}

// A sale as the portal shows it, with the profit already computed server-side.
// matchedBirdId is dropped (internal identifier); matchedInvestorId is kept
// but always equals the caller's OWN id, which they already know — it lets the
// portal keep using calculateProfitDistribution unchanged on the scoped list.
function publicSale(item, investorId) {
  return {
    id: item.id || '',
    date: item.date || '',
    orderNumber: item.orderNumber || '',
    itemDescription: item.itemDescription || item.item || '',
    quantity: item.quantity ?? 1,
    totalValue: Number(item.totalValue) || 0,
    isEgg: !!item.isEgg,
    rate: Number(item.rate) || 0,
    profitRate: Number(item.rate) || 0,
    profit: Number(item.profit) || 0,
    matchedBreed: item.matchedBird || item.matchedBreed || '',
    matchedInvestorId: investorId,
  };
}

// Operational records the employee portal needs. Deliberately excludes every
// financial and personal field: no investors, no sales, no payments, no
// aportes, no expenses (whose rows also carry base64 receipt images).
function employeeBird(bird) {
  return {
    id: bird.id,
    species: bird.species || '',
    breed: bird.breed || '',
    matrixCount: bird.matrixCount ?? '',
    annualEggPotential: bird.annualEggPotential ?? '',
    birdNotes: bird.birdNotes || '',
    individuals: Array.isArray(bird.individuals) ? bird.individuals : [],
  };
}

// Resolve a portal token to { type, investorId } without trusting the client.
// Order matters: the /shareTokens collection is authoritative, and the legacy
// forms are only accepted when no token document exists.
async function resolveToken(db, token, app) {
  const snap = await db.doc(`shareTokens/${token}`).get();
  if (snap.exists) {
    const data = snap.data() || {};
    if (data.type === 'investor' && data.investorId) {
      return { type: 'investor', investorId: data.investorId };
    }
    if (data.type === 'employee') {
      return { type: 'employee', investorId: null };
    }
    return null;
  }

  // Legacy employee link: the token was mirrored onto appData.employeeToken
  // before /shareTokens existed.
  if (app.employeeToken && app.employeeToken === token) {
    return { type: 'employee', investorId: null };
  }

  // Legacy investor link: the raw investor id worked as a token, but only for
  // investors never migrated to a portalTokenId. Once migrated, the old URL
  // must stop working.
  const investors = Array.isArray(app.investors) ? app.investors : [];
  const legacy = investors.find(i => i && i.id === token && !i.portalTokenId);
  if (legacy) return { type: 'investor', investorId: legacy.id };

  return null;
}

// Pure payload builder: given a Firestore handle and a token, decide what the
// caller is entitled to. Split out from the HTTP handler so the scoping rules
// can be tested against a fake database — this is the part that must never
// leak, so it is the part that gets tested.
export async function buildPortalPayload(db, token) {
  const t = String(token || '').trim();
  // Real tokens are UUIDs. Reject junk before it ever reaches Firestore.
  if (!t || t.length < 16 || t.length > 200) {
    return { status: 400, body: { error: 'invalid_token' } };
  }

  const appSnap = await db.doc('config/appData').get();
  const app = appSnap.exists ? (appSnap.data() || {}) : {};

  const resolved = await resolveToken(db, t, app);
  if (!resolved) return { status: 404, body: { error: 'token_not_found' } };

  const rates = {
    eggProfitRate: typeof app.eggProfitRate === 'number' ? app.eggProfitRate : undefined,
    birdProfitRate: typeof app.birdProfitRate === 'number' ? app.birdProfitRate : undefined,
  };

  if (resolved.type === 'employee') {
    const eggSnap = await db.collection('eggCollections').get();
    return {
      status: 200,
      body: {
        type: 'employee',
        birds: (app.birds || []).map(employeeBird),
        eggCollections: eggSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        incubators: app.incubators || [],
        incubatorBatches: app.incubatorBatches || [],
        nurseryRooms: app.nurseryRooms || [],
        nurseryBatches: app.nurseryBatches || [],
        nurseryEvents: app.nurseryEvents || [],
        infirmaryBays: app.infirmaryBays || [],
        infirmaryAdmissions: app.infirmaryAdmissions || [],
        treatments: app.treatments || [],
        customTreatmentTypes: app.customTreatmentTypes || [],
      },
    };
  }

  // ---- investor ----
  const investors = Array.isArray(app.investors) ? app.investors : [];
  const investor = investors.find(i => i && i.id === resolved.investorId);
  if (!investor) return { status: 404, body: { error: 'token_not_found' } };

  const allBirds = Array.isArray(app.birds) ? app.birds : [];
  const salesSnap = await db.collection('sales').get();
  const allSales = salesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Attribution runs on the server over the full dataset; only this investor's
  // slice leaves the building.
  const { distribution } = calculateProfitDistribution(allSales, allBirds, rates);
  const mine = distribution[investor.id] || { eggProfit: 0, birdProfit: 0, totalProfit: 0, items: [] };

  // Only animals the investor currently owns — the same set the portal showed
  // before. Including previously-owned animals would mean shipping a bird
  // whose current owner is somebody else.
  const myBirds = allBirds.filter(b => b && b.investorId === investor.id);

  return {
    status: 200,
    body: {
      type: 'investor',
      investor: publicInvestor(investor),
      birds: myBirds.map(b => publicBird(b, investor.id)),
      sales: (mine.items || []).map(sale => publicSale(sale, investor.id)),
      summary: {
        eggProfit: mine.eggProfit || 0,
        birdProfit: mine.birdProfit || 0,
        totalProfit: mine.totalProfit || 0,
      },
      financialInvestments: (app.financialInvestments || [])
        .filter(f => f && f.investorId === investor.id)
        .map(f => ({ id: f.id, investorId: investor.id, amount: f.amount, date: f.date })),
      payments: (app.payments || [])
        .filter(p => p && p.investorId === investor.id)
        .map(p => ({ id: p.id, investorId: investor.id, amount: p.amount, date: p.date, description: p.description || '' })),
      rates,
    },
  };
}

export default async function handler(req, res) {
  // Refuse caching everywhere: this payload is per-investor by definition. A
  // CDN serving one investor's response to another would be catastrophic.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});

  let db;
  try {
    db = getDb();
  } catch (err) {
    if (err.code === 'not_configured') {
      // Lets the client fall back to its previous behaviour during rollout.
      return res.status(503).json({ error: 'not_configured' });
    }
    return res.status(500).json({ error: 'server_error' });
  }

  try {
    const { status, body: payload } = await buildPortalPayload(db, body.token);
    return res.status(status).json(payload);
  } catch {
    // Never echo the internal error: it can disclose document paths.
    return res.status(500).json({ error: 'server_error' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
